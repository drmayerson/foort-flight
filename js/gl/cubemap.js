// @ts-check
// Cubemap tracing (plan 5.2, G3): the six 90-degree faces of a reference observer, traced by the vendored tracer into
// one record atlas (3N x 2N), chunk by chunk inside the frame budget (js/gl/scheduler.js).
//
// Long rays (the fuzzball, G1 finding; user's choice "option 1", DECISIONS G1): with `split`, the faces are traced with
// FOORT-GPU's compaction mode (+compact, 8 attachments): rays stop after `n1` steps and keep their state in the record;
// an asynchronous read-back lists the unfinished ones per face, which resume in a compact image (mode 2, step limit
// raised by n1 each round) and are scattered back. No ray then costs more than about n1 steps per frame. The rounds
// end when no ray is unfinished; the step counts and records equal a single pass's (FOORT-GPU B5: exact, up to the
// tail centroids' rounding at a phase boundary).

import { gpuTraceSetup, tableSpec, fluidSpec } from '../../vendor/foort-gpu/js/gpu/traceConfig.js';
import { gameTier } from '../render/defaults.js';
import { withCamera } from '../camera/generalTetrad.js';
import { cubeFaceCameras } from '../physics/refFrame.js';

/** @typedef {import('./tracer.js').Tracer} Tracer @typedef {import('./tracer.js').RecordTarget} RecordTarget */
/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime @typedef {import('../camera/generalTetrad.js').Frame} Frame */

export const CUBE_R_BOUNDARY = 100;
const COMPACT_W = 256;

/**
 * @typedef {Object} Cubemap
 * @property {RecordTarget} atlas
 * @property {number} N
 * @property {{pos: number[], frame: Frame, v: number[], gdd: number[][]}} ref
 * @property {any} tail
 * @property {string} program
 * @property {number} M  mass unit (M_ADM)
 * @property {{wallMs: number, rounds: number, frames: number, split: boolean, setupMs: number, firstPassMs: number}} stats
 * @property {boolean} cancelled
 */

export class CubemapTracer {
  /**
   * @param {Tracer} tracer @param {import('./scheduler.js').FrameScheduler} sched
   * @param {import('../../vendor/foort-gpu/js/bake/client.js').BakeClient} bakes
   */
  constructor(tracer, sched, bakes) {
    this.tracer = tracer; this.sched = sched; this.bakes = bakes;
    /** free atlases by key `${N}:${nAtt}` @type {Map<string, RecordTarget[]>} */
    this.pool = new Map();
    /** @type {RecordTarget|null} */
    this.compact = null;
    this.generation = 0;
    this.tablesKey = '';
    this.fluidKey = '';
  }

  /** @param {number} N @param {number} nAtt */
  take(N, nAtt) {
    const k = `${N}:${nAtt}`, free = this.pool.get(k) ?? [];
    return free.pop() ?? this.tracer.makeTarget(3 * N, 2 * N, nAtt);
  }

  /** give an atlas back for re-use @param {RecordTarget} T @param {number} N */
  release(T, N) {
    const k = `${N}:${T.tex.length}`;
    if (!this.pool.has(k)) this.pool.set(k, []);
    const free = /** @type {RecordTarget[]} */ (this.pool.get(k));
    // large atlases (512: 150-200 MB) are not kept: a sharpened cubemap is traced rarely
    if (free.length < (N > 256 ? 0 : 2)) free.push(T); else this.tracer.freeTarget(T);
  }

  /** cancel what is being traced (a newer refresh supersedes it) */
  cancel() { this.generation++; this.sched.cancelAll(); }

  /**
   * Trace a cubemap for the reference observer `ref` (tracer coordinates; js/physics/refFrame.js referenceFrame).
   * @param {Spacetime} S
   * @param {{pos: number[], frame: Frame, v: number[]}} ref
   * @param {{N: number, tier: 'reference'|'high'|'normal', split?: boolean, n1?: number}} o
   * @returns {Promise<Cubemap>}
   */
  async trace(S, ref, o) {
    const gen = this.generation;
    const t0 = performance.now();
    const [, r, th] = ref.pos;
    const mode = S.entry.mode;
    /** @type {any} */
    const view = {
      metric: S.id, metricParams: S.params, camera: { r, theta: th, phi: 0, screen: 1 }, N: o.N, rBoundary: Math.max(1.01 * r, CUBE_R_BOUNDARY),
      path: 'auto', texelReuse: true, fluid: { xi: 1, betaR: 1, betaPhi: 1, model: 'banded' }, ...gameTier(o.tier, mode),
    };
    const split = !!o.split && this.tracer.compactSupported();
    const ts = tableSpec(view);
    const fs = fluidSpec(view);
    const tables = ts ? (await this.bakes.get(ts)).tables : undefined;
    const fluid = (await this.bakes.get(fs)).tables;
    const setup = gpuTraceSetup(view, tables, fluid);
    const program = setup.program + (split ? '+compact' : '');
    await this.tracer.prepare(program);
    // (re-)upload the tables only when they change: a refresh of the same spacetime keeps them
    if (ts && ts.key !== this.tablesKey) { this.tracer.uploadTables(tables); this.tablesKey = ts.key; }
    if (fs.key !== this.fluidKey) { this.tracer.uploadFluid(fluid); this.fluidKey = fs.key; }
    const tSetup = performance.now() - t0;
    const gdd = S.gTracer(r, th);
    const faces = cubeFaceCameras({ gdd, position: ref.pos, r0: S.rHorizon, frame: ref.frame, N: o.N });
    const nAtt = split ? 8 : 6;
    const atlas = this.take(o.N, nAtt);
    this.tracer.clearTarget(atlas);
    const n1 = o.n1 ?? 600;
    const faceUniforms = faces.map((f) => {
      /** @type {any} */
      const u = withCamera(/** @type {any} */ (setup.uniforms), f);
      if (split) u.uCompact = ['4i', [1, n1, 0, 0]];
      return u;
    });
    /** @type {Cubemap} */
    const cube = { atlas, N: o.N, ref: { ...ref, gdd }, tail: setup.tail, program, M: S.metric.massADM,
      stats: { wallMs: 0, rounds: 0, frames: 0, split, setupMs: tSetup, firstPassMs: 0 }, cancelled: false };
    const jobs = faces.map((f, k) => this.sched.submit(program, faceUniforms[k], atlas, f.rect));
    const res = await Promise.all(jobs.map((j) => j.done));
    cube.stats.frames += Math.max(...res.map((x) => x.frames));
    cube.stats.firstPassMs = performance.now() - t0 - tSetup;
    if (gen !== this.generation || res.some((x) => /** @type {any} */ (x).cancelled)) { this.release(atlas, o.N); return { ...cube, cancelled: true }; }

    if (split) {
      const W = 3 * o.N, H = 2 * o.N;
      let limit = n1;
      for (;;) {
        const rec0 = await this.tracer.readRec0(atlas);
        if (gen !== this.generation) { this.release(atlas, o.N); return { ...cube, cancelled: true }; }
        // unfinished rays per face (termination code 8 or 9 in the low 4 bits)
        /** @type {number[][]} */
        const lists = faces.map(() => []);
        for (let p = 0; p < W * H; p++) {
          const c = Math.round(rec0[4 * p]) & 15;
          if (c === 8 || c === 9) {
            const x = p % W, y = (p - x) / W;
            lists[Math.floor(y / o.N) * 3 + Math.floor(x / o.N)].push(p);
          }
        }
        const total = lists.reduce((s, l) => s + l.length, 0);
        if (!total || limit > view.maxSteps + n1) break;
        limit += n1;
        cube.stats.rounds++;
        // the compact image: each face's rays in whole rows of COMPACT_W
        const rows = lists.map((l) => Math.ceil(l.length / COMPACT_W));
        const Hc = rows.reduce((s, x) => s + x, 0);
        if (!this.compact || this.compact.h < Hc) {
          if (this.compact) this.tracer.freeTarget(this.compact);
          this.compact = this.tracer.makeTarget(COMPACT_W, Math.max(Hc, 64), 8);
        }
        const C = this.compact;
        const idx = new Int32Array(COMPACT_W * C.h).fill(-1);
        let row = 0;
        /** @type {{face: number, region: {x: number, y: number, w: number, h: number}}[]} */
        const parts = [];
        lists.forEach((l, k) => {
          if (!l.length) return;
          idx.set(l, row * COMPACT_W);
          parts.push({ face: k, region: { x: 0, y: row, w: COMPACT_W, h: rows[k] } });
          row += rows[k];
        });
        const index = this.tracer.indexTexture(COMPACT_W, C.h, idx);
        /** @type {Record<string, WebGLTexture|null>} */
        const textures = { uIndex: index };
        for (let k = 0; k < 8; k++) textures[`uPrev${k}`] = atlas.tex[k];
        const rj = parts.map((p) => this.sched.submit(program, { ...faceUniforms[p.face], uCompact: ['4i', [2, limit, 0, 0]] }, C, p.region, { img: [W, H], textures }));
        const rr = await Promise.all(rj.map((j) => j.done));
        cube.stats.frames += Math.max(...rr.map((x) => x.frames));
        if (gen !== this.generation || rr.some((x) => /** @type {any} */ (x).cancelled)) { this.tracer.gl.deleteTexture(index); this.release(atlas, o.N); return { ...cube, cancelled: true }; }
        this.tracer.scatter(C, index, atlas);
        this.tracer.gl.deleteTexture(index);
      }
    }
    cube.stats.wallMs = performance.now() - t0;
    return cube;
  }
}

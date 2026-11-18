// @ts-check
// cubemap.html (G3): the cubemap renderer of plan 5.2 on scripted camera paths. Every frame the view is drawn from the
// newest complete cubemap (turning, moving in t and phi and changing velocity cost nothing); new cubemaps are traced
// continuously in the background inside the frame budget, double-buffered, and skipped while nothing has changed.
// Paths: turn (look around at a fixed place), orbit (circular orbit: phi only, exact by symmetry), dive (radial in and
// out: the cubemap goes stale and refreshes), close (near the centre, small radial motion: refreshes all the time),
// flyby (fast and changing radius).
import { checkWebGL2, noWebGL2Message } from './gl/context.js';
import { createTracer } from './gl/tracer.js';
import { FrameScheduler } from './gl/scheduler.js';
import { createDisplay } from './gl/display.js';
import { createDebugDisplay } from './gl/debugDisplay.js';
import { CubemapTracer } from './gl/cubemap.js';
import { createSpacetime } from './physics/spacetime.js';
import { referenceFrame, shipToReference, staleness } from './physics/refFrame.js';
import { observerState, frameToTracer, shipCamera } from './camera/shipCamera.js';
import { withCamera } from './camera/generalTetrad.js';
import { BakeClient } from '../vendor/foort-gpu/js/bake/client.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from '../vendor/foort-gpu/js/gpu/traceConfig.js';
import { autoNoiseField, loadNoiseField } from '../vendor/foort-gpu/js/noise/noiseField.js';
import { summarize } from './gpu/timing.js';
import { gameTier, EMISSION } from './render/defaults.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
const q = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const TIME_RATE = 20;   // M of coordinate time per second of wall time (display)

/**
 * The scripted paths: (wall time s) -> an observer spec for observerState (tracer r, theta, phi, t; family; boost;
 * attitude). All kinematic (free mode): the observer is placed, not integrated.
 * @type {Record<string, (s: number) => any>}
 */
export const PATHS = {
  turn: (s) => ({ kind: 'zamo', r: 12, theta: 80 * DEG, t: TIME_RATE * s, yaw: 70 * DEG * Math.sin(0.5 * s), pitch: 15 * DEG * Math.sin(0.31 * s) }),
  orbit: (s) => {
    const r = 8, Om = 1 / (r ** 1.5 + 0.9), t = TIME_RATE * s;
    return { kind: 'circularPro', r, theta: 90 * DEG, t, phi: Om * t, yaw: 60 * DEG, pitch: -5 * DEG };
  },
  dive: (s) => ({ kind: 'zamo', r: 20 - 14 * Math.sin(Math.PI * s / 16) ** 2, theta: 80 * DEG, t: TIME_RATE * s, yaw: 0, pitch: 0 }),
  close: (s) => ({ kind: 'zamo', r: 3.5 + 0.5 * Math.sin(0.3 * s), theta: 80 * DEG, t: TIME_RATE * s, yaw: 40 * DEG * Math.sin(0.4 * s), pitch: 0 }),
  flyby: (s) => ({ kind: 'zamo', r: 10 + 6 * Math.cos(0.2 * s), theta: (80 + 8 * Math.sin(0.15 * s)) * DEG, t: TIME_RATE * s, phi: 0.3 * s,
    v: 0.8, dir: 'prograde', yaw: 90 * DEG, pitch: 0 }),
};

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const check = checkWebGL2();
  if (!check.ok) { $('error').innerHTML = noWebGL2Message(check); document.body.dataset.ready = 'error'; return; }
  const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance' }));
  const tracer = await createTracer(gl);
  const display = await createDisplay(gl);
  const debug = await createDebugDisplay(gl);
  const sched = new FrameScheduler(tracer);
  const bakes = new BakeClient();
  const cubes = new CubemapTracer(tracer, sched, bakes);

  const ui = {
    spacetime: q.get('spacetime') ?? 'kerr', path: q.get('path') ?? 'turn', faceN: Number(q.get('faceN') ?? 256), tier: q.get('tier') ?? 'normal',
    color: Number(q.get('color') ?? 1), sky: Number(q.get('sky') ?? 1), fov: Number(q.get('fov') ?? 70), atlas: Number(q.get('atlas') ?? 1), play: Number(q.get('play') ?? 1),
  };
  for (const [k, v] of Object.entries(ui)) { const el = $(k); if (el) el.value = String(v); }
  let S = createSpacetime(/** @type {any} */ (ui.spacetime), ui.spacetime === 'kerr' ? { a: 0.9 } : ui.spacetime === 'st3cr' ? { lambda: 0.005 } : {});
  let wall = 0;          // path time (s), advances while playing
  /** @type {import('./gl/cubemap.js').Cubemap|null} */
  let current = null;
  let refreshes = 0, lastRefresh = /** @type {any} */ (null), idle = false;
  /** @type {(s: number) => any} */
  let pathFn = PATHS[ui.path];
  let override = /** @type {any} */ (null);   // tests: a fixed state instead of the path
  let noiseName = '';

  /** the ship state now: event and frame in tracer coordinates (built in ship coordinates and mapped) */
  const shipState = () => {
    const spec = override ?? pathFn(wall);
    const ob = observerState(S, spec);
    if (!ob.X) throw new Error(ob.reason);
    const pos = S.toTracer(ob.X);
    return { spec, X: ob.X, Fship: ob.F, pos, frame: frameToTracer(S, ob.X, ob.F), g: S.gTracer(pos[1], pos[2]) };
  };

  // refresh loop
  let loopGen = 0;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  async function refreshLoop(gen) {
    while (gen === loopGen) {
      const st = shipState();
      if (current && current.N === ui.faceN) {
        const m = shipToReference(st.g, st.frame, current.ref.gdd, current.ref.frame, current.ref.v);
        const sl = staleness({ r: st.pos[1], theta: st.pos[2] }, { r: current.ref.pos[1], theta: current.ref.pos[2] }, m.M);
        // nothing to gain: wait (refresh priority follows staleness, plan 5.2)
        if (sl.pos < 1e-5 && sl.vel < 1e-5) { idle = true; await nextFrame(); continue; }
      }
      idle = false;
      const ref = referenceFrame(st.g, st.frame);
      const N = current ? ui.faceN : Math.max(32, ui.faceN / 4);   // coarse first
      const cm = await cubes.trace(S, { pos: st.pos, frame: ref.frame, v: ref.v }, { N, tier: /** @type {any} */ (ui.tier), split: S.id === 'st3cr' });
      if (gen !== loopGen || cm.cancelled) { if (!cm.cancelled) cubes.release(cm.atlas, cm.N); continue; }
      if (current) cubes.release(current.atlas, current.N);
      current = cm;
      refreshes++;
      lastRefresh = { ...cm.stats, N: cm.N };
      await nextFrame();
    }
  }
  const restart = () => {
    loopGen++;
    cubes.cancel();
    if (current) { cubes.release(current.atlas, current.N); current = null; }
    const nn = autoNoiseField(S.id, S.params);
    if (nn !== noiseName) { noiseName = nn; loadNoiseField(nn).then((F) => { if (noiseName === nn) display.setNoise(F); }); }
    refreshLoop(loopGen);
  };

  const DP = (/** @type {number} */ tObs, /** @type {number} */ az) => ({
    colorMode: Number(ui.color), skyMode: Number(ui.sky), em: EMISSION, exposure: 1, autoExposure: true, T0: 4500, rRef: 6,
    sigmaN: 0.6, tObs, slowLight: true, azimuth: az, starBrightness: 1, pixelAngle: (ui.fov * DEG) / canvas.width,
  });

  /** draw the current state from the current cubemap @param {{raw?: boolean, w?: number, h?: number}} [o] */
  const drawView = (o = {}) => {
    if (!current) return null;
    const st = shipState();
    const m = shipToReference(st.g, st.frame, current.ref.gdd, current.ref.frame, current.ref.v);
    const tan = Math.tan(ui.fov * DEG / 2);
    const w = o.w ?? canvas.width, h = o.h ?? canvas.height;
    display.drawCube(current.atlas, current.N, { M: m.colMajor, refT: m.refT, tanX: tan * Math.max(1, w / h), tanY: tan * Math.max(1, h / w) },
      tracer.fluid(), current.tail, DP(st.pos[0], st.pos[3] - current.ref.pos[3]), w, h, { raw: o.raw, M: current.M, w: canvas.width, h: canvas.height });
    return { st, m };
  };

  // frame loop
  /** @type {number[]} */
  const intervals = [];
  let prev = NaN, hudT = 0;
  const frame = (/** @type {number} */ now) => {
    const dt = now - prev;
    if (Number.isFinite(dt)) { intervals.push(dt); if (intervals.length > 600) intervals.shift(); if (Number(ui.play)) wall += dt / 1000; }
    prev = now;
    sched.frame(now);
    try {
      const v = drawView();
      if (v && Number(ui.atlas) && current) {
        const aw = Math.round(canvas.width * 0.3);
        debug.draw(current.atlas, { mode: 0, x: canvas.width - aw - 8, y: 8, w: aw, h: Math.round(aw * 2 / 3) });
      }
      if (now - hudT > 250) { hudT = now; hud(v); }
    } catch (e) { $('note').textContent = String(e); }
    sched.endFrame();
    requestAnimationFrame(frame);
  };
  const hud = (/** @type {any} */ v) => {
    const iv = summarize(intervals.slice(-120));
    let stale = '';
    if (v && current) {
      const sl = staleness({ r: v.st.pos[1], theta: v.st.pos[2] }, { r: current.ref.pos[1], theta: current.ref.pos[2] }, v.m.M);
      stale = ` · staleness: position ${sl.pos.toExponential(1)}, speed ${sl.vel.toExponential(1)}`;
    }
    const lr = lastRefresh ? ` · last cubemap ${lastRefresh.N}²×6 in ${(lastRefresh.wallMs / 1000).toFixed(2)} s, ${lastRefresh.frames} frames${lastRefresh.split ? `, ${lastRefresh.rounds} resume rounds` : ''}` : '';
    $('hud').textContent = `${(1000 / iv.median).toFixed(1)} fps (frame p90 ${iv.p90.toFixed(1)} ms) · ${refreshes} cubemaps${idle ? ' (idle: up to date)' : ''}${lr}${stale}`;
    if (v) $('info').textContent = `r = ${v.st.pos[1].toFixed(2)} M, θ = ${(v.st.pos[2] / DEG).toFixed(1)}°, φ = ${v.st.pos[3].toFixed(2)}, t = ${v.st.pos[0].toFixed(0)} M`;
  };

  // controls
  for (const k of Object.keys(ui)) {
    const el = $(k);
    if (!el) continue;
    el.addEventListener('change', () => {
      /** @type {any} */ (ui)[k] = ['path', 'tier', 'spacetime'].includes(k) ? el.value : Number(el.value);
      if (k === 'path') { pathFn = PATHS[ui.path]; wall = 0; restart(); }
      if (k === 'spacetime') { S = createSpacetime(/** @type {any} */ (ui.spacetime), ui.spacetime === 'kerr' ? { a: 0.9 } : ui.spacetime === 'st3cr' ? { lambda: 0.005 } : {}); restart(); }
      if (k === 'faceN' || k === 'tier') restart();
    });
  }
  restart();
  requestAnimationFrame(frame);

  // test hooks
  /** @type {any} */ (window).__g3 = {
    PATHS, ui,
    stats: () => ({ frames: summarize(intervals.slice(5)), refreshes, lastRefresh, idle }),
    /** run a path for `seconds` and report the frame pacing and refreshes @param {string} path @param {number} seconds */
    async fly(path, seconds) {
      ui.path = path; pathFn = PATHS[path]; wall = 0; override = null; restart();
      while (!current) await nextFrame();
      const r0 = refreshes;
      intervals.length = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 1000 * seconds) await nextFrame();
      return { path, seconds, frames: summarize(intervals.slice(2)), refreshes: refreshes - r0, lastRefresh };
    },
    /**
     * Ray splitting is exact: the same cubemap traced in one pass and split into resume rounds; the fraction of pixels
     * whose 24-float records are bit-identical, and of those whose termination and crossings agree.
     * @param {any} spec @param {{faceN: number, spacetime: string, params: any, n1?: number}} o
     */
    async splitCheck(spec, o) {
      loopGen++; cubes.cancel(); ui.play = 0;
      S = createSpacetime(/** @type {any} */ (o.spacetime), o.params);
      override = spec;
      const st = shipState();
      const ref = referenceFrame(st.g, st.frame);
      const one = await cubes.trace(S, { pos: st.pos, frame: ref.frame, v: ref.v }, { N: o.faceN, tier: 'normal', split: false });
      const recA = await tracer.readRecords(one.atlas);
      const two = await cubes.trace(S, { pos: st.pos, frame: ref.frame, v: ref.v }, { N: o.faceN, tier: 'normal', split: true, n1: o.n1 });
      const recB = await tracer.readRecords(two.atlas);
      cubes.release(one.atlas, one.N); cubes.release(two.atlas, two.N);
      override = null;
      const n = recA.length / 24, ua = new Uint32Array(recA.buffer), ub = new Uint32Array(recB.buffer);
      let ident = 0, core = 0;
      for (let p = 0; p < n; p++) {
        let same = true, sameCore = true;
        for (let k = 0; k < 24; k++) if (ua[24 * p + k] !== ub[24 * p + k]) { same = false; if (k < 16) sameCore = false; }
        if (same) ident++;
        if (sameCore) core++;
      }
      return { identical: ident / n, recordCoreIdentical: core / n, rounds: two.stats.rounds, wallOne: one.stats.wallMs, wallSplit: two.stats.wallMs };
    },

    /**
     * Cubemap vs direct trace of the same observer (plan 5.2 validation): a fresh cubemap at exactly this state, drawn
     * raw at N x N; and a direct trace of the same camera, drawn raw, with its records.
     * @param {any} spec observer spec @param {{N: number, faceN: number, spacetime?: string, params?: any, tier?: string}} o
     */
    async compare(spec, o) {
      loopGen++; cubes.cancel(); ui.play = 0;
      if (o.spacetime) S = createSpacetime(/** @type {any} */ (o.spacetime), o.params ?? {});
      override = spec;
      const st = shipState();
      const ref = referenceFrame(st.g, st.frame);
      const cm = await cubes.trace(S, { pos: st.pos, frame: ref.frame, v: ref.v }, { N: o.faceN, tier: /** @type {any} */ (o.tier ?? 'normal'), split: S.id === 'st3cr' });
      if (current) cubes.release(current.atlas, current.N);
      current = cm;
      drawView({ raw: true, w: o.N, h: o.N });
      const cube = display.readRaw();
      // direct
      const cam = shipCamera(S, st.X, st.Fship, ui.fov * DEG);
      const [, r, th] = cam.position;
      /** @type {any} */
      const view = { metric: S.id, metricParams: S.params, camera: { r, theta: th, phi: 0, screen: 1 }, N: o.N, rBoundary: Math.max(1.01 * r, 100),
        path: 'auto', texelReuse: true, fluid: { xi: 1, betaR: 1, betaPhi: 1, model: 'banded' }, ...gameTier(/** @type {any} */ (o.tier ?? 'normal'), S.entry.mode) };
      const ts = tableSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const fluid = (await bakes.get(fluidSpec(view))).tables;
      const setup = gpuTraceSetup(view, tables, fluid);
      await tracer.prepare(setup.program);
      if (tables) tracer.uploadTables(tables);
      tracer.uploadFluid(fluid);
      cubes.tablesKey = ''; cubes.fluidKey = '';
      const T = tracer.makeTarget(o.N, o.N);
      tracer.clearTarget(T);
      const u = withCamera(/** @type {any} */ (setup.uniforms), cam, { bs3: view.bs3, N: o.N });
      await sched.submit(setup.program, u, T).done;
      display.draw(T, u, tracer.fluid(), setup.tail, DP(st.pos[0], 0), { raw: true, M: S.metric.massADM });
      const direct = display.readRaw();
      const rec = await tracer.readRecords(T);
      tracer.freeTarget(T);
      const dirs = new Float32Array(2 * o.N * o.N);
      for (let p = 0; p < o.N * o.N; p++) { dirs[2 * p] = rec[24 * p + 2]; dirs[2 * p + 1] = rec[24 * p + 3]; }
      override = null;
      return { cube: Array.from(cube?.data ?? []), direct: Array.from(direct?.data ?? []), dirs: Array.from(dirs), cubeStats: cm.stats, pixelAngle: (ui.fov * DEG) / o.N };
    },
  };
  document.body.dataset.ready = '1';
}

main().catch((e) => { console.error(e); $('error').textContent = `Start-up failed: ${e?.message ?? e}`; document.body.dataset.ready = 'error'; });

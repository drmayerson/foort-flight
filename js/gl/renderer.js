// @ts-check
// The game's renderer (G4): WebGL2 context, tracer, per-frame scheduler, cubemap refresh loop and display, behind a
// small interface. Every animation frame: `frame(now, ship)` encodes trace chunks, draws the view of `ship` from the
// newest complete cubemap, and fences. Cubemaps are refreshed in the background (G3): coarse first, then at the face
// size of the quality setting, idle while nothing has changed.

import { createTracer } from './tracer.js';
import { FrameScheduler } from './scheduler.js';
import { createDisplay } from './display.js';
import { createDebugDisplay } from './debugDisplay.js';
import { CubemapTracer } from './cubemap.js';
import { BakeClient } from '../../vendor/foort-gpu/js/bake/client.js';
import { autoNoiseField, loadNoiseField } from '../../vendor/foort-gpu/js/noise/noiseField.js';
import { referenceFrame, shipToReference, staleness } from '../physics/refFrame.js';
import { EMISSION, gameTier } from '../render/defaults.js';
import { pinholeUniforms, withCamera } from '../camera/generalTetrad.js';
import { gpuTraceSetup, tableSpec, fluidSpec } from '../../vendor/foort-gpu/js/gpu/traceConfig.js';
import { CUBE_R_BOUNDARY } from './cubemap.js';

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime */
/** @typedef {{pos: number[], frame: import('../camera/generalTetrad.js').Frame, g: number[][]}} TracerState  ship in tracer coordinates */

/**
 * @typedef {Object} RenderSettings
 * @property {number} faceN       cubemap face size
 * @property {'reference'|'high'|'normal'} tier
 * @property {number} fov         horizontal field of view (rad)
 * @property {number} colorMode   0 FOORT colour map, 1 blackbody
 * @property {number} skyMode     0 none, 1 stars, 2 picture
 * @property {number} sigmaN      turbulence
 * @property {number} T0          blackbody temperature at 6 M (K)
 * @property {number} exposure    multiplier
 * @property {number} starBrightness
 * @property {boolean} inset      show the cubemap being traced
 * @property {{mu:number, gamma:number, sigma:number, p:number, fudge:number, maxPasses:number, circumferential:boolean}} [em]
 */

export const RENDER_DEFAULTS = /** @type {RenderSettings} */ ({
  faceN: 256, tier: 'normal', fov: 75 * Math.PI / 180, colorMode: 1, skyMode: 1, sigmaN: 0.6, T0: 4500, exposure: 1, starBrightness: 1, inset: false,
});

/** @param {HTMLCanvasElement} canvas */
export async function createRenderer(canvas) {
  const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
  if (!gl) throw new Error('WebGL2 is not available');
  const tracer = await createTracer(gl);
  const display = await createDisplay(gl);
  const debug = await createDebugDisplay(gl);
  const sched = new FrameScheduler(tracer);
  const bakes = new BakeClient();
  const cubes = new CubemapTracer(tracer, sched, bakes);

  /** @type {Spacetime|null} */
  let S = null;
  /** @type {import('./cubemap.js').Cubemap|null} */
  let current = null;
  /** @type {TracerState|null} */
  let latest = null;   // the ship state of the last frame (the refresh loop traces for it)
  let settings = { ...RENDER_DEFAULTS };
  let loopGen = 0, refreshes = 0, idle = false, noiseName = '';
  /** @type {any} */
  let lastRefresh = null;
  /** recent cubemap refreshes (G8 acceptance timings) @type {any[]} */
  const history = [];
  /** @type {any} */
  let lastView = null;
  /** photo mode (G7): a direct trace of the screen at full resolution, shown instead of the cubemap @type {any} */
  let photo = null;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  async function refreshLoop(/** @type {number} */ gen) {
    while (gen === loopGen) {
      if (!latest || !S) { await nextFrame(); continue; }
      const st = latest;
      if (current && current.N === settings.faceN) {
        const m = shipToReference(st.g, st.frame, current.ref.gdd, current.ref.frame, current.ref.v);
        const sl = staleness({ r: st.pos[1], theta: st.pos[2] }, { r: current.ref.pos[1], theta: current.ref.pos[2] }, m.M);
        if (sl.pos < 1e-5 && sl.vel < 1e-5) { idle = true; await nextFrame(); continue; }
      }
      idle = false;
      let cm;
      try {
        const ref = referenceFrame(st.g, st.frame);
        const N = current ? settings.faceN : Math.max(32, settings.faceN / 4);
        // long fuzzball rays are split across frames for the continuous refresh; the one coarse cubemap at the start of
        // a scene is traced in one pass (a few slow frames, but no read-back rounds: G8, coarse in < 0.5 s)
        cm = await cubes.trace(S, { pos: st.pos, frame: ref.frame, v: ref.v }, { N, tier: settings.tier, split: S.id === 'st3cr' && N >= 128 });
      } catch (e) {
        // e.g. no ZAMO (inside a horizon): the caller keeps the ship out; wait and retry
        console.warn('cubemap refresh failed', e);
        await nextFrame();
        continue;
      }
      if (gen !== loopGen || cm.cancelled) { if (!cm.cancelled) cubes.release(cm.atlas, cm.N); continue; }
      if (current) cubes.release(current.atlas, current.N);
      current = cm;
      refreshes++;
      lastRefresh = { ...cm.stats, N: cm.N };
      history.push({ N: cm.N, wallMs: cm.stats.wallMs, rounds: cm.stats.rounds, spacetime: S?.id, setupMs: cm.stats.setupMs, firstPassMs: cm.stats.firstPassMs, frames: cm.stats.frames });
      if (history.length > 50) history.shift();
      await nextFrame();
    }
  }

  const api = {
    gl, tracer, sched,
    /** a new spacetime: drops the cubemaps and restarts the refresh loop @param {Spacetime} s */
    setSpacetime(s) {
      S = s;
      loopGen++;
      cubes.cancel();
      if (current) { cubes.release(current.atlas, current.N); current = null; }
      const nn = autoNoiseField(s.id, s.params);
      if (nn !== noiseName) { noiseName = nn; loadNoiseField(nn).then((F) => { if (noiseName === nn) display.setNoise(F); }).catch(() => {}); }
      refreshLoop(loopGen);
    },
    /** @param {Partial<RenderSettings>} s */
    configure(s) {
      const restart = (s.faceN !== undefined && s.faceN !== settings.faceN) || (s.tier !== undefined && s.tier !== settings.tier);
      settings = { ...settings, ...s };
      if (restart && S) { loopGen++; cubes.cancel(); refreshLoop(loopGen); }
    },
    settings: () => settings,

    /**
     * Photo mode (plan 7.7, G7): trace the current camera directly, pixel by pixel, at the canvas's resolution (no
     * cubemap, no blending); shown until stopPhoto. The cubemap refresh pauses meanwhile.
     * @param {TracerState} ship
     */
    async startPhoto(ship) {
      if (!S) return;
      api.stopPhoto();
      loopGen++; cubes.cancel();
      const w = canvas.width, h = canvas.height, [, r, th] = ship.pos;
      /** @type {any} */
      const view = { metric: S.id, metricParams: S.params, camera: { r, theta: th, phi: 0, screen: 1 }, N: w, rBoundary: Math.max(1.01 * r, CUBE_R_BOUNDARY),
        path: 'auto', texelReuse: true, fluid: { xi: 1, betaR: 1, betaPhi: 1, model: 'banded' }, ...gameTier(settings.tier, S.entry.mode) };
      const ts = tableSpec(view), fs = fluidSpec(view);
      const tables = ts ? (await bakes.get(ts)).tables : undefined;
      const fluid = (await bakes.get(fs)).tables;
      const setup = gpuTraceSetup(view, tables, fluid);
      await tracer.prepare(setup.program);
      if (ts && ts.key !== cubes.tablesKey) { tracer.uploadTables(tables); cubes.tablesKey = ts.key; }
      if (fs.key !== cubes.fluidKey) { tracer.uploadFluid(fluid); cubes.fluidKey = fs.key; }
      const cam = pinholeUniforms({ gdd: ship.g, position: ship.pos, r0: S.rHorizon, frame: ship.frame, fov: settings.fov });
      const sx = cam.uScreen[1][2];
      cam.uScreen = ['4f', [0, 0, sx, sx * h / w]];
      const uniforms = withCamera(/** @type {any} */ (setup.uniforms), cam);
      const T = tracer.makeTarget(w, h);
      tracer.clearTarget(T);
      const job = sched.submit(setup.program, uniforms, T);
      photo = { T, uniforms, tail: setup.tail, M: S.metric.massADM, pos: ship.pos, job, started: performance.now(), done: false };
      job.done.then((r) => { if (photo && photo.job === job) { photo.done = !r.cancelled; photo.wallMs = r.wallMs; } });
    },
    stopPhoto() {
      if (!photo) return;
      sched.cancelAll();
      tracer.freeTarget(photo.T);
      photo = null;
      if (S) { loopGen++; refreshLoop(loopGen); }
    },
    photoState: () => (photo ? { progress: photo.job.raysDone / photo.job.raysTotal, done: photo.done, wallMs: photo.wallMs ?? NaN } : null),
    /** @param {TexImageSource} img */
    setSkyPicture: (img) => display.setSkyPicture(img),

    /**
     * One animation frame. `ship` in tracer coordinates; `tObs` its coordinate time (for the disc's flicker).
     * @param {number} now @param {TracerState} ship
     */
    frame(now, ship) {
      latest = ship;
      sched.frame(now);
      const w = canvas.width, h = canvas.height;
      lastView = null;
      if (photo) {
        const P = {
          colorMode: settings.colorMode, skyMode: settings.skyMode, em: settings.em ?? EMISSION, exposure: settings.exposure, autoExposure: true,
          T0: settings.T0, rRef: 6, sigmaN: settings.sigmaN, tObs: photo.pos[0], slowLight: true, azimuth: 0,
          starBrightness: settings.starBrightness, pixelAngle: settings.fov / w,
        };
        display.draw(photo.T, photo.uniforms, tracer.fluid(), photo.tail, P, { M: photo.M });
      } else if (current) {
        const m = shipToReference(ship.g, ship.frame, current.ref.gdd, current.ref.frame, current.ref.v);
        const tan = Math.tan(settings.fov / 2), aspect = w / h;
        const P = {
          colorMode: settings.colorMode, skyMode: settings.skyMode, em: settings.em ?? EMISSION, exposure: settings.exposure, autoExposure: true,
          T0: settings.T0, rRef: 6, sigmaN: settings.sigmaN, tObs: ship.pos[0], slowLight: true, azimuth: ship.pos[3] - current.ref.pos[3],
          starBrightness: settings.starBrightness, pixelAngle: settings.fov / w,
        };
        display.drawCube(current.atlas, current.N, { M: m.colMajor, refT: m.refT, tanX: tan, tanY: tan / aspect }, tracer.fluid(), current.tail, P, w, h, { M: current.M });
        if (settings.inset) {
          const aw = Math.round(Math.min(w, h) * 0.3);
          debug.draw(current.atlas, { mode: 0, x: w - aw - 8, y: 8, w: aw, h: Math.round(aw * 2 / 3) });
        }
        const sl = staleness({ r: ship.pos[1], theta: ship.pos[2] }, { r: current.ref.pos[1], theta: current.ref.pos[2] }, m.M);
        lastView = { m, staleness: sl, refT: m.refT };
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.02, 0.02, 0.03, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      sched.endFrame();
      return lastView;
    },

    /**
     * The ship factor s = E_ship / E_inf for a look direction d = (f, right, up) of the ship (the display's formula, on
     * the CPU): needs the current cubemap's map of the last frame.
     * @param {number[]} d
     */
    shift(d) {
      if (!lastView) return NaN;
      const M = lastView.m.M, n = Math.hypot(d[0], d[1], d[2]);
      const ps = [-1, d[0] / n, d[1] / n, d[2] / n];
      const pr = M.map((row) => row.reduce((acc, v, b) => acc + v * ps[b], 0));
      const Er = -pr[0], dr = [pr[1] / Er, pr[2] / Er, pr[3] / Er];
      const pt = lastView.refT[0] + dr[0] * lastView.refT[1] + dr[1] * lastView.refT[2] + dr[2] * lastView.refT[3];
      return 1 / (Er * pt);
    },
    history: () => history.slice(),
    stats: () => ({ refreshes, idle, lastRefresh, cube: current ? { N: current.N, ref: current.ref.pos } : null, sched: sched.stats(), exposure: display.exposure(), view: lastView }),
    hasCube: () => !!current,
  };
  return api;
}

/** @typedef {Awaited<ReturnType<typeof createRenderer>>} Renderer */

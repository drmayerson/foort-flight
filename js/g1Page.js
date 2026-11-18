// @ts-check
// tracer.html (G1): the vendored FOORT-GPU tracer run by the game's backend and per-frame scheduler, for a static
// observer. The display animates (the four-colour screen turns with the azimuth, an exact symmetry) while traces run,
// so the frame rate under tracing load is visible. URL: ?scene=&tier=&N=&camera=foort|pinhole&mode=&loop=1
import { checkWebGL2, noWebGL2Message } from './gl/context.js';
import { createTracer, RECORD_FLOATS } from './gl/tracer.js';
import { FrameScheduler } from './gl/scheduler.js';
import { createDebugDisplay, DEBUG_MODES } from './gl/debugDisplay.js';
import { staticFrame, pinholeUniforms, withCamera } from './camera/generalTetrad.js';
import { BakeClient } from '../vendor/foort-gpu/js/bake/client.js';
import { fluidSpec, tableSpec, gpuTraceSetup } from '../vendor/foort-gpu/js/gpu/traceConfig.js';
import { tierSettings } from '../vendor/foort-gpu/js/gpu/tiers.js';
import { metricEntry } from '../vendor/foort-gpu/js/metrics/registry.js';
import { inverseMetric, toMat4 } from '../vendor/foort-gpu/js/metrics/common.js';
import { summarize } from './gpu/timing.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const q = new URLSearchParams(location.search);
const DEG = Math.PI / 180;

/** scenes of FOORT-GPU's quality gate (dev/scripts/gateConfigs.mjs), cameras in units of M */
export const SCENES = {
  'kerr_a0.94_inc17': { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 17 * DEG, screen: 15 } },
  'kerr_a0.94_inc80': { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  kerr_a0_inc80: { metric: 'kerr', metricParams: { a: 0 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  'st3cr_l5e-3': { metric: 'st3cr', metricParams: { lambda: 5e-3 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 } },
  'st3cr_l1e-3': { metric: 'st3cr', metricParams: { lambda: 1e-3 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 } },
  st3cr_l0: { metric: 'st3crBH', metricParams: {}, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 } },
};

/**
 * The traced view of a scene at a tier: the vendored tier settings and the B5 exact speedups (closed-form path auto,
 * texel reuse), as FOORT-GPU's quality gate traces it.
 * @param {keyof typeof SCENES | any} scene @param {'reference'|'high'|'normal'} tier @param {number} N
 */
export function sceneView(scene, tier, N) {
  const s = typeof scene === 'string' ? SCENES[/** @type {keyof typeof SCENES} */ (scene)] : scene;
  const mode = metricEntry(s.metric).mode;
  return { ...s, N, path: 'auto', texelReuse: true, fluid: { xi: 1, betaR: 1, betaPhi: 1 }, ...tierSettings(tier, mode) };
}

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
  const check = checkWebGL2();
  if (!check.ok) { $('error').innerHTML = noWebGL2Message(check); document.body.dataset.ready = 'error'; return; }
  const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance' }));
  const tracer = await createTracer(gl);
  const display = await createDebugDisplay(gl);
  const sched = new FrameScheduler(tracer);
  const bakes = new BakeClient();
  /** @type {import('./gl/tracer.js').RecordTarget|null} */
  let target = null;
  /** @type {import('./gl/scheduler.js').TraceJob|null} */
  let job = null;
  let maxSteps = 5000;
  /** @type {any} */
  let last = null;

  /**
   * Start a trace (cancels queued work). Returns the job.
   * @param {any} view @param {{camera?: 'foort'|'pinhole'}} [o]
   */
  async function startTrace(view, o = {}) {
    sched.cancelAll();
    const ts = tableSpec(view);
    const tables = ts ? (await bakes.get(ts)).tables : undefined;
    const fluid = (await bakes.get(fluidSpec(view))).tables;
    const setup = gpuTraceSetup(view, tables, fluid);
    await tracer.prepare(setup.program);
    if (tables) tracer.uploadTables(tables);
    tracer.uploadFluid(fluid);
    if (!target || target.w !== view.N) { if (target) tracer.freeTarget(target); target = tracer.makeTarget(view.N, view.N); }
    tracer.clearTarget(target);
    let uniforms = /** @type {import('./gl/tracer.js').Uniforms} */ (setup.uniforms);
    if (o.camera === 'pinhole') {
      const { r, theta } = view.camera, m = setup.metric;
      const gdd = toMat4(m.g_dd(r, theta)), guu = toMat4(inverseMetric(m)(r, theta));
      const cam = pinholeUniforms({ gdd, position: [0, r, theta, view.camera.phi ?? 0], r0: m.horizon.kind === 'sphere' ? m.horizon.r : 0,
        frame: staticFrame(gdd, guu), fov: 2 * Math.atan(view.camera.screen / (2 * r)) });
      uniforms = withCamera(uniforms, cam, { bs3: view.bs3, N: view.N });
    }
    maxSteps = view.maxSteps;
    job = sched.submit(setup.program, uniforms, target);
    last = { view, camera: o.camera ?? 'foort', program: setup.program, started: performance.now(), result: null };
    const L = last;
    job.done.then((r) => { L.result = r; });
    return job;
  }

  // the frame loop: trace chunks, display, fence
  /** @type {number[]} */
  const intervals = [];
  let prev = NaN, az = 0, hudT = 0;
  const frame = (/** @type {number} */ now) => {
    if (!Number.isNaN(prev)) { intervals.push(now - prev); if (intervals.length > 600) intervals.shift(); az += 0.5 * (now - prev) / 1000; }
    prev = now;
    sched.frame(now);
    if (target) display.draw(target, { mode: Number(/** @type {HTMLSelectElement} */ ($('mode')).value), azimuth: az, maxSteps });
    sched.endFrame();
    if (now - hudT > 250) { hudT = now; hud(); }
    requestAnimationFrame(frame);
  };

  const hud = () => {
    const iv = summarize(intervals.slice(-120));
    const s = sched.stats();
    const prog = job ? Math.round(100 * job.raysDone / job.raysTotal) : 0;
    const res = last?.result;
    $('hud').textContent = `${(1000 / iv.median).toFixed(1)} fps (frame p90 ${iv.p90.toFixed(1)} ms; refresh ${s.refreshMs.toFixed(1)} ms) · `
      + `budget ${(s.R / 1000).toFixed(1)}k rays/frame${Number.isFinite(s.rate) ? `, ${(s.rate / 1000).toFixed(0)}k rays/GPU ms (timer)` : ' (fences)'} · in flight ${s.inflight} · `
      + (res ? `trace ${(res.wallMs / 1000).toFixed(2)} s in ${res.frames} frames` : `tracing ${prog}%`);
  };

  const fromUi = () => sceneView(/** @type {HTMLSelectElement} */ ($('scene')).value, /** @type {any} */ (/** @type {HTMLSelectElement} */ ($('tier')).value), Number(/** @type {HTMLSelectElement} */ ($('N')).value));
  const camUi = () => /** @type {'foort'|'pinhole'} */ (/** @type {HTMLSelectElement} */ ($('camera')).value);
  let looping = false;
  const loop = async () => {
    while (looping) { const j = await startTrace(fromUi(), { camera: camUi() }); await j.done; }
  };
  for (const id of ['scene', 'tier', 'N', 'camera']) $(id).addEventListener('change', () => startTrace(fromUi(), { camera: camUi() }));
  $('retrace').onclick = () => startTrace(fromUi(), { camera: camUi() });
  /** @type {HTMLInputElement} */ ($('loop')).onchange = (e) => { looping = /** @type {HTMLInputElement} */ (e.target).checked; if (looping) loop(); };

  // URL settings
  for (const k of ['scene', 'tier', 'N', 'camera', 'mode']) if (q.has(k)) /** @type {HTMLSelectElement} */ ($(k)).value = /** @type {string} */ (q.get(k));
  $('gpu').textContent = `${check.renderer}; timer queries: ${check.timerQueries ? 'yes' : 'no'}`;
  requestAnimationFrame(frame);

  // test hooks (Playwright, dev/scripts)
  /** @type {any} */ (window).__g1 = {
    SCENES, sceneView,
    /** trace a view to completion; returns the records (base64) and timings @param {any} view @param {{camera?: 'foort'|'pinhole'}} [o] */
    async trace(view, o = {}) {
      const j = await startTrace(view, o);
      const r = await j.done;
      const rec = await tracer.readRecords(/** @type {any} */ (target));
      const bytes = new Uint8Array(rec.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ...r, program: last.program, records: btoa(bin), floats: RECORD_FLOATS };
    },
    /** trace repeatedly for `seconds`, then report the frame pacing @param {any} view @param {number} seconds */
    async load(view, seconds) {
      await (await startTrace(view)).done;   // compile and bake outside the measured window
      intervals.length = 0;
      const t0 = performance.now();
      const traces = [];
      while (performance.now() - t0 < 1000 * seconds) traces.push(await (await startTrace(view)).done);
      const iv = summarize(intervals.slice(5));
      return { fps: 1000 / iv.median, frameMs: iv, refreshMs: sched.refreshMs, traces: traces.length, traceWallMs: summarize(traces.map((t) => t.wallMs)), sched: sched.stats(), frameLog: sched.trace.slice(-120) };
    },
    stats: () => ({ sched: sched.stats(), frames: summarize(intervals.slice(-120)) }),
  };
  document.body.dataset.ready = '1';
  if (!q.has('notrace')) startTrace(fromUi(), { camera: camUi() });
  if (q.has('loop')) { /** @type {HTMLInputElement} */ ($('loop')).checked = true; looping = true; loop(); }
}

main().catch((e) => { console.error(e); $('error').textContent = `Start-up failed: ${e?.message ?? e}`; document.body.dataset.ready = 'error'; });

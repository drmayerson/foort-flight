// @ts-check
// observer.html (G2): direct per-pixel rendering for a general observer. The observer (ZAMO, static or circular, a
// boost, an attitude) is set up in the ship's coordinates (Kerr-Schild / base Cartesian) and mapped to the tracer's;
// the image is traced directly (the cubemap is G3) and shown with the ship-frame redshift, the disc in the FOORT colour
// map or as blackbodies, and the sky. Drag on the image to look around (re-traces); the disc flickers with the noise.
import { checkWebGL2, noWebGL2Message } from './gl/context.js';
import { createTracer } from './gl/tracer.js';
import { FrameScheduler } from './gl/scheduler.js';
import { createDisplay } from './gl/display.js';
import { withCamera } from './camera/generalTetrad.js';
import { shipCamera, observerState } from './camera/shipCamera.js';
import { createSpacetime } from './physics/spacetime.js';
import { BakeClient } from '../vendor/foort-gpu/js/bake/client.js';
import { fluidSpec, tableSpec, gpuTraceSetup } from '../vendor/foort-gpu/js/gpu/traceConfig.js';
import { autoNoiseField, loadNoiseField } from '../vendor/foort-gpu/js/noise/noiseField.js';
import { SKY_PICTURES } from '../vendor/foort-gpu/js/sky.js';
import { summarize } from './gpu/timing.js';
import { gameTier, EMISSION, R_BOUNDARY } from './render/defaults.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
const q = new URLSearchParams(location.search);
const DEG = Math.PI / 180;


/** state defaults; every key is also a URL parameter and a control id */
export const DEFAULTS = {
  spacetime: 'kerr', a: 0.9, lambda: 0.005,
  kind: 'zamo', r: 12, theta: 80, v: 0, dir: 'look', yaw: 0, pitch: 0, roll: 0, fov: 60,
  tier: 'normal', N: 384, color: 1, sky: 1, sigmaN: 0.6, exposure: 1, T0: 4500, play: 1,
};

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const check = checkWebGL2();
  if (!check.ok) { $('error').innerHTML = noWebGL2Message(check); document.body.dataset.ready = 'error'; return; }
  const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance' }));
  const tracer = await createTracer(gl);
  const display = await createDisplay(gl);
  const sched = new FrameScheduler(tracer);
  const bakes = new BakeClient();

  /** @type {Record<string, any>} */
  const state = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (q.has(k)) state[k] = typeof DEFAULTS[/** @type {keyof typeof DEFAULTS} */ (k)] === 'number' ? Number(q.get(k)) : q.get(k);
  for (const k of Object.keys(state)) { const el = $(k); if (el) el.value = String(state[k]); }

  /** @type {import('./gl/tracer.js').RecordTarget|null} */
  let target = null;
  /** @type {any} */
  let shown = null;   // what the display shows: camera uniforms, tail, M
  /** @type {any} */
  let pending = null;
  let noiseName = '';
  let tObs = 0;

  const spacetimeOf = (/** @type {any} */ s) => s.spacetime === 'kerr' ? createSpacetime('kerr', { a: s.a })
    : s.spacetime === 'st3crBH' ? createSpacetime('st3crBH', {}) : createSpacetime('st3cr', { lambda: s.lambda });

  /** Build and start the trace of a state. Returns {job, info} or {error}. @param {Record<string, any>} s */
  async function render(s) {
    sched.cancelAll();
    const S = spacetimeOf(s);
    const ob = observerState(S, { kind: s.kind, r: s.r, theta: s.theta * DEG, v: s.v, dir: s.dir, yaw: s.yaw * DEG, pitch: s.pitch * DEG, roll: s.roll * DEG });
    if (!ob.X) { $('note').textContent = ob.reason; return { error: ob.reason }; }
    const cam = shipCamera(S, ob.X, ob.F, s.fov * DEG);
    const [, r, th] = cam.position;
    const mode = S.entry.mode;
    /** @type {any} */
    const view = {
      metric: S.id, metricParams: S.params, camera: { r, theta: th, phi: 0, screen: 1 }, N: s.N, rBoundary: Math.max(1.01 * r, R_BOUNDARY),
      path: 'auto', texelReuse: true, fluid: { xi: 1, betaR: 1, betaPhi: 1, model: 'banded' }, ...gameTier(s.tier, mode),
    };
    const ts = tableSpec(view);
    const tables = ts ? (await bakes.get(ts)).tables : undefined;
    const fluid = (await bakes.get(fluidSpec(view))).tables;
    const setup = gpuTraceSetup(view, tables, fluid);
    await tracer.prepare(setup.program);
    if (tables) tracer.uploadTables(tables);
    tracer.uploadFluid(fluid);
    const uniforms = withCamera(/** @type {any} */ (setup.uniforms), cam, { bs3: view.bs3, N: s.N });
    if (!target || target.w !== s.N) { if (target) tracer.freeTarget(target); target = tracer.makeTarget(s.N, s.N); }
    tracer.clearTarget(target);
    const nn = autoNoiseField(S.id, S.params);
    if (nn !== noiseName) { noiseName = nn; loadNoiseField(nn).then((F) => { if (noiseName === nn) display.setNoise(F); }); }
    const job = sched.submit(setup.program, uniforms, target);
    shown = { cam: uniforms, tail: setup.tail, M: S.metric.massADM, S, X: ob.X, pos: cam.position, s };
    $('note').textContent = [...setup.warnings.filter((w) => !/d_t is not timelike/.test(w))].join('; ');
    hudInfo();
    return { job, setup };
  }

  const DP = () => ({
    colorMode: Number(state.color), skyMode: Number(state.sky), em: EMISSION, exposure: Number(state.exposure), autoExposure: true,
    T0: Number(state.T0), rRef: 6, sigmaN: Number(state.sigmaN), tObs, slowLight: true, azimuth: 0, starBrightness: 1,
    pixelAngle: (Number(state.fov) * DEG) / Number(state.N),
  });

  // the frame loop
  /** @type {number[]} */
  const intervals = [];
  let prev = NaN, hudT = 0;
  const frame = (/** @type {number} */ now) => {
    const dt = now - prev;
    if (Number.isFinite(dt)) { intervals.push(dt); if (intervals.length > 300) intervals.shift(); if (Number(state.play)) tObs += 20 * dt / 1000; }
    prev = now;
    sched.frame(now);
    if (target && shown) display.draw(target, shown.cam, tracer.fluid(), shown.tail, DP(), { M: shown.M });
    sched.endFrame();
    if (now - hudT > 250) { hudT = now; hud(); }
    requestAnimationFrame(frame);
  };
  const hud = () => {
    const iv = summarize(intervals.slice(-60));
    const job = sched.queue[0];
    $('hud').textContent = `${(1000 / iv.median).toFixed(0)} fps · ${job ? `tracing ${Math.round(100 * job.raysDone / job.raysTotal)}%` : 'traced'} · exposure ${display.exposure().toPrecision(3)} · t = ${tObs.toFixed(0)} M`;
  };
  const hudInfo = () => {
    if (!shown) return;
    const { S, X, pos } = shown;
    const c = shown.cam;
    // the ship factor at the image centre (as the display computes it)
    const sCentre = centreShift(c);
    $('info').textContent = `${S.shipName} event (${X.slice(1).map((v) => v.toFixed(3)).join(', ')}) → tracer r = ${pos[1].toFixed(3)} M, θ = ${(pos[2] / DEG).toFixed(2)}° · `
      + `light from straight ahead shifted ×${sCentre.toFixed(3)} (sky at infinity)`;
  };

  /** the ship factor s = 1/p_t of the centre pixel (js/physics/redshift.js; the display does the same per pixel) */
  const centreShift = (/** @type {any} */ c) => {
    const E = c.uE[1], G = c.uG[1];
    const pf = [-1, -1, 0, 0];   // centre: D = rc
    const p = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].reduce((acc, a) => acc + E[4 * a + i] * pf[a], 0));
    const pt = [0, 1, 2, 3].reduce((acc, j) => acc + G[4 * j] * p[j], 0);
    return 1 / pt;
  };

  // controls
  const rerender = () => { for (const k of Object.keys(DEFAULTS)) { const el = $(k); if (el) state[k] = typeof DEFAULTS[/** @type {keyof typeof DEFAULTS} */ (k)] === 'number' ? Number(el.value) : el.value; } render(state); };
  for (const k of Object.keys(DEFAULTS)) {
    const el = $(k);
    if (!el) continue;
    const displayOnly = ['color', 'sky', 'sigmaN', 'exposure', 'T0', 'play'].includes(k);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', () => { if (displayOnly) state[k] = Number(el.value); else rerender(); });
  }
  // drag to look around: yaw / pitch, re-trace on release
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: Number(state.yaw), pitch: Number(state.pitch) }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = Number(state.fov) / canvas.clientWidth;
    $('yaw').value = String(Math.round(drag.yaw - (e.clientX - drag.x) * k));
    $('pitch').value = String(Math.max(-89, Math.min(89, Math.round(drag.pitch + (e.clientY - drag.y) * k))));
  });
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; rerender(); } });
  // sky picture choice
  const pic = $('picture');
  pic.innerHTML = Object.entries(SKY_PICTURES).map(([k, v]) => `<option value="${k}">${k} — ${v.credit.en}</option>`).join('');
  const loadPic = () => {
    const img = new Image();
    img.onload = () => display.setSkyPicture(img);
    img.src = new URL(`../vendor/foort-gpu/sky/${SKY_PICTURES[pic.value].file}`, import.meta.url).href;
  };
  pic.addEventListener('change', loadPic);
  loadPic();

  requestAnimationFrame(frame);

  // test hooks
  /** @type {any} */ (window).__g2 = {
    state, DEFAULTS,
    /** render a state to completion; returns the raw (s, I, code, steps) image and info @param {Record<string, any>} s */
    async render(s) {
      Object.assign(state, s);
      const res = await render(state);
      if (!res.job) return { error: res.error };
      const done = await res.job.done;
      display.draw(/** @type {any} */ (target), shown.cam, tracer.fluid(), shown.tail, DP(), { raw: true, M: shown.M });
      const raw = display.readRaw();
      return { ...done, w: raw?.w, raw: raw ? Array.from(raw.data) : null, position: shown.pos, X: shown.X, centreShift: centreShift(shown.cam), program: res.setup.program };
    },
    frames: () => summarize(intervals.slice(-120)),
  };
  document.body.dataset.ready = '1';
  if (!q.has('notrace')) render(state);
}

main().catch((e) => { console.error(e); $('error').textContent = `Start-up failed: ${e?.message ?? e}`; document.body.dataset.ready = 'error'; });

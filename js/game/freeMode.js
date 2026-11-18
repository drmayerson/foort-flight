// @ts-check
// Free mode (plan 2, 7.1; G4): a kinematic camera. It moves anywhere in the ship's coordinates (Kerr-Schild / base
// Cartesian) without inertia or curvature, and looks through a chosen local observer (ZAMO by default; static or a
// circular orbit where they exist, else the ZAMO with a note). The attitude is kept as two Cartesian unit vectors
// (forward, up) of the ship's coordinate space: smooth everywhere, also across the axis, where the observers' own
// (r, theta, phi) frames turn. Each frame the forward/up/right directions are orthonormalised against the observer's
// 4-velocity (forward first, so the look direction is exactly the chosen one).
// Clocks: the observer's proper time advances at TIME_RATE M per second; its coordinate time at u^t times that.

import { observer } from '../physics/observers.js';
import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { frameToTracer } from '../camera/shipCamera.js';

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime @typedef {number[]} Vec3 @typedef {number[]} Vec4 */

export const FAMILIES = /** @type {const} */ (['zamo', 'static', 'circularPro', 'circularRetro']);

const dot3 = (/** @type {Vec3} */ a, /** @type {Vec3} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (/** @type {Vec3} */ a, /** @type {Vec3} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (/** @type {Vec3} */ a) => { const n = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / n); };
/** rotate v about the unit axis k by angle a (Rodrigues) @param {Vec3} v @param {Vec3} k @param {number} a */
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), d = dot3(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * d * (1 - c));
}

/**
 * @typedef {Object} FreeState
 * @property {Vec4} X        event (t, x, y, z) in ship coordinates
 * @property {Vec3} fwd      look direction (Cartesian unit vector)
 * @property {Vec3} up
 * @property {string} family
 * @property {number} speed  coordinate speed as a fraction of the distance from the centre per second (scales span
 *                           0.01 M inside the fuzzball's cap to 100 M)
 * @property {number} tau    proper time of the observer (M)
 */

/**
 * A start: at tracer (r, theta, phi), looking at the centre, north up.
 * @param {Spacetime} S @param {{r: number, theta: number, phi?: number, family?: string, speed?: number}} o @returns {FreeState}
 */
export function freeStart(S, o) {
  const X = S.fromTracer([0, o.r, o.theta, o.phi ?? 0]);
  const p = [X[1], X[2], X[3]];
  const fwd = norm3(p.map((x) => -x));
  let up = [0, 0, 1];
  up = norm3(up.map((x, i) => x - dot3(up, fwd) * fwd[i]));
  return { X, fwd, up, family: o.family ?? 'zamo', speed: o.speed ?? 0.25, tau: 0 };
}

/** the right vector of an attitude (right-handed (f, right, up)) @param {FreeState} st */
export const rightOf = (st) => cross(st.up, st.fwd);

/**
 * The minimum distance from the centre (ship coordinates) where the camera may go: outside the Kerr horizon (5%
 * margin; the flight itself ends at the horizon, plan F2), outside the fuzzball's inner cut and singularities.
 * @param {Spacetime} S @param {Vec4} X
 */
export function allowed(S, X) {
  const r = S.rShip(X);
  if (S.id === 'kerr') {
    const B = S.toTracer(X);
    return B[1] > 1.05 * S.rHorizon && Number.isFinite(B[1]) ? '' : 'the horizon is just ahead: free mode stops here (crossing it is for physical mode, and ends the flight)';
  }
  const rTerm = S.metric.terminationRadius?.() ?? 0;
  if (S.id === 'st3crBH' && r < 30 * rTerm) return 'the λ = 0 black hole: its horizon lies at the end of an infinitely long throat; free mode stops here';
  if (r < 10 * rTerm) return 'too close to the centre of the fuzzball';
  // the fuzzball's singular sources (D6 centres on the axis, the D0 ring): keep a few singularity distances away
  const eps = 10 * (S.metric.singularityEpsilon?.() ?? 0);
  for (const s of S.metric.singularities()) {
    const sx = s.r * Math.sin(s.theta), sz = s.r * Math.cos(s.theta);
    const d = s.kind === 'ring' ? Math.hypot(Math.hypot(X[1], X[2]) - sx, X[3] - sz) : Math.hypot(Math.hypot(X[1], X[2]), X[3] - sz);
    if (d < eps) return `too close to a ${s.kind === 'ring' ? 'D0 ring' : 'D6 centre'} (singular in the 4D description, smooth in string theory)`;
  }
  return '';
}

/**
 * The observer and camera frame at the state's event, in ship and tracer coordinates. Falls back to the ZAMO (with a
 * note) where the chosen family does not exist.
 * @param {Spacetime} S @param {FreeState} st
 */
export function freeFrame(S, st) {
  const B = S.toTracer(st.X);
  const [, r, th] = B;
  const gT = S.gTracer(r, th);
  let note = '';
  let ob = observer(/** @type {any} */ (st.family), S.gTracer, r, th);
  if (!ob.u) { note = `${/** @type {any} */ (ob).reason}; showing the ZAMO`; ob = observer('zamo', S.gTracer, r, th); }
  const uT = /** @type {Vec4} */ (ob.u);
  const u = S.vecToShip(st.X, uT);
  const g = S.gShip(st.X);
  const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(g, a, b);
  const leg = (/** @type {Vec3} */ c, /** @type {Vec4[]} */ prev) => {
    let w = [0, c[0], c[1], c[2]];
    w = w.map((x, i) => x + ip(w, u) * u[i]);
    for (const p of prev) { const k = ip(w, p); w = w.map((x, i) => x - k * p[i]); }
    const n = Math.sqrt(ip(w, w));
    return w.map((x) => x / n);
  };
  const f = leg(st.fwd, []);
  const up = leg(st.up, [f]);
  const right = leg(rightOf(st), [f, up]);
  const F = { u, f, right, up };
  return { F, tracer: { pos: B, frame: frameToTracer(S, st.X, F), g: gT }, uT, note };
}

/**
 * Advance the free camera by dt seconds of wall time.
 * @param {Spacetime} S @param {FreeState} st
 * @param {{move: number[], look: number[], roll: number, speedFactor: number}} input move: (fwd, right, up) in [-1, 1];
 *        look: (yaw, pitch) in rad, roll in rad; speedFactor multiplies the speed
 * @param {number} dt @param {number} timeRate M of proper time per second
 * @returns {{state: FreeState, note: string}}
 */
export function freeStep(S, st, input, dt, timeRate) {
  let fwd = st.fwd, up = st.up;
  let right = cross(up, fwd);
  if (input.look[0]) { fwd = rotate(fwd, up, -input.look[0]); }
  right = cross(up, fwd);
  if (input.look[1]) { fwd = rotate(fwd, right, -input.look[1]); up = rotate(up, right, -input.look[1]); }
  if (input.roll) { up = rotate(up, fwd, input.roll); }
  fwd = norm3(fwd);
  up = norm3(up.map((x, i) => x - dot3(up, fwd) * fwd[i]));
  right = cross(up, fwd);
  const speed = Math.min(Math.max(st.speed * input.speedFactor, 0.005), 5);
  const vel = speed * Math.max(S.rShip(st.X), 1e-3);
  const dir = [0, 1, 2].map((i) => fwd[i] * input.move[0] + right[i] * input.move[1] + up[i] * input.move[2]);
  let X = st.X;
  let note = '';
  const moved = dir.some((x) => x !== 0);
  if (moved) {
    const Xn = [X[0], X[1] + vel * dt * dir[0], X[2] + vel * dt * dir[1], X[3] + vel * dt * dir[2]];
    note = allowed(S, Xn);
    if (!note) X = Xn;
  }
  // clocks: proper time at the time rate; coordinate time at u^t (tracer t, which is what the disc's time uses)
  const fr = freeFrame(S, { ...st, X, fwd, up });
  const dtau = timeRate * dt;
  const dtCoord = dtau * fr.uT[0];
  // advance t in ship coordinates: for both maps a pure t shift is the same shift of the tracer's t
  X = [X[0] + dtCoord, X[1], X[2], X[3]];
  return { state: { ...st, X, fwd, up, speed, tau: st.tau + dtau }, note };
}

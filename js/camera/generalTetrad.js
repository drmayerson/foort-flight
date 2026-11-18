// @ts-check
// General tetrad camera for FOORT-GPU's unchanged GLSL tracer (plan v1.1, G1; DECISIONS.md).
//
// The tracer (vendor/foort-gpu/shaders/glsl/common.glsl) builds the ray of screen point (alpha, beta) as
//   pflat = (-1, -rc/D, -beta/(rc D), alpha/(rc sin(delta_c) D)),  D = sqrt(rc^2 + alpha^2 + beta^2),
//   p^mu  = uE * pflat,
// with rc = uCam.x and delta_c = uCam.y. Choosing the columns of uE as
//   E0 = u,  E1 = -f,  E2 = -rc up,  E3 = rc sin(delta_c) right
// (u the observer's 4-velocity, f/right/up an orthonormal spatial triad) gives
//   p = -u + (rc f + alpha right + beta up) / D,
// a past-directed null ray whose local look direction is the pinhole direction (rc, alpha, beta) in (f, right, up):
// plan 4.3's k^(a) ~ (-1, d). So any observer, any attitude and any cube face (a 90-degree square screen) need only
// uE, uCam and uScreen. For FOORT's static observer (f = -e_r, up = -e_theta, right = e_phi) this is the same uE as
// TetradCamera.fromStaticObserver.
//
// Coordinates are the tracer's (t, r, theta, phi) with the true r (Boyer-Lindquist-like for Kerr, the base for ST3Cr).

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */
/** @typedef {{u: Vec4, f: Vec4, right: Vec4, up: Vec4}} Frame  contravariant; u timelike unit, f/right/up orthonormal */

/** @param {Vec4} a @param {Vec4} b @param {number} s */
const axpy = (a, b, s) => a.map((x, i) => x + s * b[i]);
/** @param {Vec4} a @param {number} s */
const scale = (a, s) => a.map((x) => x * s);

/**
 * FOORT's static observer and its orthonormal legs (the Gram-Schmidt order of ViewScreen: d_t, d_phi, grad r,
 * grad theta), without FOORT's r and r sin(theta) factors.
 * @param {Mat4} gdd @param {Mat4} guu
 * @returns {{u: Vec4, er: Vec4, eth: Vec4, ephi: Vec4, timelike: boolean}}
 */
export function staticLegs(gdd, guu) {
  const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(gdd, a, b);
  const norm = (/** @type {Vec4} */ a) => { const n = ip(a, a); return { v: scale(a, 1 / Math.sqrt(Math.abs(n))), s: Math.sign(n) }; };
  const e0 = norm([1, 0, 0, 0]);
  const proj = (/** @type {Vec4} */ a, /** @type {{v: Vec4, s: number}[]} */ legs) => legs.reduce((acc, L) => axpy(acc, L.v, -L.s * ip(a, L.v)), a);
  const e3 = norm(proj([0, 0, 0, 1], [e0]));
  const e1 = norm(proj(guu[1], [e0, e3]));
  const e2 = norm(proj(guu[2], [e0, e3, e1]));
  return { u: e0.v, er: e1.v, eth: e2.v, ephi: e3.v, timelike: e0.s < 0 };
}

/**
 * FOORT's camera orientation for a static observer: looking at the centre (f = -e_r), screen beta up = north
 * (up = -e_theta), alpha along +e_phi.
 * @param {Mat4} gdd @param {Mat4} guu @returns {Frame & {timelike: boolean}}
 */
export function staticFrame(gdd, guu) {
  const L = staticLegs(gdd, guu);
  return { u: L.u, f: scale(L.er, -1), right: L.ephi, up: scale(L.eth, -1), timelike: L.timelike };
}

/**
 * Turn a frame's spatial triad by a rotation R given in the frame's own (f, right, up) basis: the new legs are
 * f' = R00 f + R10 right + R20 up, etc. (columns of R = new legs in old components).
 * @param {Frame} F @param {number[][]} R 3x3
 * @returns {Frame}
 */
export function rotateFrame(F, R) {
  const b = [F.f, F.right, F.up];
  const leg = (/** @type {number} */ c) => b.reduce((acc, v, i) => axpy(acc, v, R[i][c]), [0, 0, 0, 0]);
  return { u: F.u, f: leg(0), right: leg(1), up: leg(2) };
}

/**
 * The six cube-face frames of a frame (each a 90-degree square pinhole): +f, -f, +right, -right, +up, -up.
 * Face orientation (right, up) follows the usual cubemap convention seen from inside.
 * @param {Frame} F @returns {Frame[]}
 */
export function cubeFaceFrames(F) {
  const n = (/** @type {Vec4} */ v) => scale(v, -1);
  return [
    { u: F.u, f: F.f, right: F.right, up: F.up },          // front
    { u: F.u, f: n(F.f), right: n(F.right), up: F.up },    // back
    { u: F.u, f: F.right, right: n(F.f), up: F.up },       // right
    { u: F.u, f: n(F.right), right: F.f, up: F.up },       // left
    { u: F.u, f: F.up, right: F.right, up: n(F.f) },       // up
    { u: F.u, f: n(F.up), right: F.right, up: F.f },       // down
  ];
}

/**
 * Camera uniforms of the tracer for a pinhole camera: uE, uG, uCam, uScreen and the hemisphere (uAux.z).
 * The screen spans the full angle `fov` across alpha and beta (square), centred on the direction f, offset by
 * (cx, cy) in units of the half-width.
 * @param {{gdd: Mat4, position: Vec4, r0: number, frame: Frame, fov: number, cx?: number, cy?: number}} o
 */
export function pinholeUniforms(o) {
  const [, r, theta, phi] = o.position;
  const delta = Math.min(theta, Math.PI - theta);
  const s = Math.sin(delta);
  const E = [o.frame.u, scale(o.frame.f, -1), scale(o.frame.up, -r), scale(o.frame.right, r * s)];
  const uE = new Float32Array(16), uG = new Float32Array(16);
  for (let a = 0; a < 4; a++) for (let i = 0; i < 4; i++) uE[4 * a + i] = E[a][i];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) uG[4 * j + i] = o.gdd[i][j];
  const half = r * Math.tan(o.fov / 2);
  return {
    uE: /** @type {['m4', Float32Array]} */ (['m4', uE]),
    uG: /** @type {['m4', Float32Array]} */ (['m4', uG]),
    uCam: /** @type {['4f', number[]]} */ (['4f', [r, delta, phi, Math.log(r - o.r0)]]),
    uScreen: /** @type {['4f', number[]]} */ (['4f', [(o.cx ?? 0) * half, (o.cy ?? 0) * half, 2 * half, 2 * half]]),
    hemi: theta <= Math.PI / 2 ? 1 : -1,
    E,
  };
}

/**
 * The past-directed null momentum the tracer starts with at screen point (alpha, beta), in double: p = uE pflat.
 * @param {Vec4[]} E columns (pinholeUniforms().E) @param {number} rc @param {number} delta @param {number} alpha @param {number} beta
 */
export function rayMomentum(E, rc, delta, alpha, beta) {
  const D = Math.sqrt(rc * rc + alpha * alpha + beta * beta);
  const pf = [-1, -rc / D, -beta / rc / D, alpha / rc / Math.sin(delta) / D];
  return [0, 1, 2, 3].map((i) => E.reduce((acc, col, a) => acc + col[i] * pf[a], 0));
}

/**
 * Lorentz boost of a frame: the observer moving with velocity v = (vf, vright, vup) (|v| < 1, in units of c) relative
 * to F, measured in F's triad. The new triad is the boosted F triad (no Thomas rotation added).
 * @param {Frame} F @param {number[]} v
 * @returns {Frame}
 */
export function boostFrame(F, v) {
  const b2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (!(b2 < 1)) throw new Error('boostFrame: |v| must be < 1');
  if (b2 === 0) return { ...F };
  const g = 1 / Math.sqrt(1 - b2);
  const legs = [F.f, F.right, F.up];
  const n = legs.reduce((acc, L, i) => axpy(acc, L, v[i]), [0, 0, 0, 0]);   // v in coordinates
  const u = scale(axpy(F.u, n, 1), g);
  // e_i' = e_i + (g - 1) (v_i / b2) v_vec + g v_i u
  const leg = (/** @type {number} */ i) => axpy(axpy(legs[i], n, (g - 1) * v[i] / b2), F.u, g * v[i]);
  return { u, f: leg(0), right: leg(1), up: leg(2) };
}

/**
 * Replace the camera uniforms of a gpuTraceSetup with a pinhole camera (same view, same tracer). With the error-
 * controlled integrator (bs3: {tol, cap}), its tolerance is rescaled to this camera's pixel angle (N pixels across).
 * @param {Record<string, any>} uniforms from traceConfig.gpuTraceSetup @param {ReturnType<typeof pinholeUniforms>} cam
 * @param {{bs3?: {tol: number, cap: number}|null, N?: number}} [o]
 */
export function withCamera(uniforms, cam, o = {}) {
  const aux = [...uniforms.uAux[1]];
  aux[2] = cam.hemi;
  /** @type {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} */
  const out = { ...uniforms, uE: cam.uE, uG: cam.uG, uCam: cam.uCam, uScreen: cam.uScreen, uAux: ['4f', aux] };
  if (o.bs3 && o.N) out.uBS = ['4f', [o.bs3.tol * cam.uScreen[1][2] / (o.N * cam.uCam[1][0]), o.bs3.cap, 0, 0]];
  return out;
}

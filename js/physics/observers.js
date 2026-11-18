// @ts-check
// Observer families and camera frames (plan 4.3), in the tracer's coordinates (t, r, theta, phi) of a stationary,
// axisymmetric, circular metric.
//   ZAMO     u = (d_t + omega d_phi) / alpha, omega = -g_tphi / g_phiphi, alpha^2 = -(g_tt - g_tphi^2 / g_phiphi)
//   static   u = d_t / sqrt(-g_tt), only where d_t is timelike (not in the Kerr ergoregion)
//   circular u = (d_t + Omega d_phi) u^t on the equator, Omega of a circular geodesic (prograde/retrograde), where it
//            is timelike
// A frame is the observer's u and a triad (f, right, up) built from the coordinate directions: before the attitude,
// the camera looks at the centre (f = -r^), right = phi^, up = -theta^ (FOORT's static camera), each orthonormalised
// against u (so for a moving observer the base triad is its own rest-frame version of those directions).

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { rotateFrame } from '../camera/generalTetrad.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */
/** @typedef {import('../camera/generalTetrad.js').Frame} Frame */
/** @typedef {'zamo'|'static'|'circularPro'|'circularRetro'} ObserverKind */

const axpy = (/** @type {Vec4} */ a, /** @type {Vec4} */ b, /** @type {number} */ s) => a.map((x, i) => x + s * b[i]);
const scale = (/** @type {Vec4} */ a, /** @type {number} */ s) => a.map((x) => x * s);

/** @param {Mat4} g */
export function zamo(g) {
  const om = -g[0][3] / g[3][3];
  const alpha2 = -(g[0][0] - g[0][3] * g[0][3] / g[3][3]);
  if (!(alpha2 > 0)) return null;
  return { u: scale([1, 0, 0, om], 1 / Math.sqrt(alpha2)), omega: om, alpha: Math.sqrt(alpha2) };
}

/** @param {Mat4} g */
export function staticObserver(g) {
  if (!(g[0][0] < 0)) return null;
  return { u: [1 / Math.sqrt(-g[0][0]), 0, 0, 0] };
}

/**
 * Circular geodesic on the equator: Omega from d_r g (4th-order differences), u^t from normalisation.
 * @param {(r:number, th:number) => Mat4} gAt @param {number} r @param {boolean} prograde
 */
export function circularOrbit(gAt, r, prograde) {
  const th = Math.PI / 2, h = 1e-4 * r;
  const d = (/** @type {number} */ i, /** @type {number} */ j) =>
    (-gAt(r + 2 * h, th)[i][j] + 8 * gAt(r + h, th)[i][j] - 8 * gAt(r - h, th)[i][j] + gAt(r - 2 * h, th)[i][j]) / (12 * h);
  const tt = d(0, 0), tp = d(0, 3), pp = d(3, 3);
  const disc = tp * tp - tt * pp;
  if (!(disc >= 0) || pp === 0) return null;
  // the two roots of g_tt,r + 2 Omega g_tphi,r + Omega^2 g_phiphi,r = 0; prograde = the larger Omega (co-rotating)
  const o1 = (-tp + Math.sqrt(disc)) / pp, o2 = (-tp - Math.sqrt(disc)) / pp;
  const Om = prograde ? Math.max(o1, o2) : Math.min(o1, o2);
  const g = gAt(r, th);
  const n = -(g[0][0] + 2 * Om * g[0][3] + Om * Om * g[3][3]);
  if (!(n > 0)) return null;
  const ut = 1 / Math.sqrt(n);
  return { u: [ut, 0, 0, Om * ut], Omega: Om };
}

/**
 * The observer of a family at (r, theta); null where it does not exist (with the reason).
 * @param {ObserverKind} kind @param {(r:number, th:number) => Mat4} gAt @param {number} r @param {number} th
 * @returns {{u: Vec4} | {u: null, reason: string}}
 */
export function observer(kind, gAt, r, th) {
  const g = gAt(r, th);
  if (kind === 'zamo') return zamo(g) ?? { u: null, reason: 'no ZAMO here (inside the horizon)' };
  if (kind === 'static') return staticObserver(g) ?? { u: null, reason: 'no static observer here: inside the ergoregion even infinite thrust cannot hold a ship still (d_t is not timelike)' };
  if (Math.abs(th - Math.PI / 2) > 1e-9) return { u: null, reason: 'circular orbits exist only in the equatorial plane' };
  return circularOrbit(gAt, r, kind === 'circularPro') ?? { u: null, reason: 'no circular orbit at this radius (inside the photon orbit)' };
}

/**
 * The base frame of an observer u at (r, theta): f = -r^, right = phi^, up = -theta^, orthonormalised against u.
 * @param {Mat4} g @param {Vec4} u
 * @returns {Frame}
 */
export function baseFrame(g, u) {
  const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(g, a, b);
  /** project out u (u.u = -1) and earlier legs, normalise */
  const leg = (/** @type {Vec4} */ v, /** @type {Vec4[]} */ prev) => {
    let w = axpy(v, u, ip(v, u));
    for (const p of prev) w = axpy(w, p, -ip(w, p));
    return scale(w, 1 / Math.sqrt(ip(w, w)));
  };
  // Gram-Schmidt order as FOORT's static camera: phi first (so that a static observer's base triad is FOORT's)
  const ephi = leg([0, 0, 0, 1], []);
  const er = leg([0, 1, 0, 0], [ephi]);
  const eth = leg([0, 0, 1, 0], [ephi, er]);
  return { u, f: scale(er, -1), right: ephi, up: scale(eth, -1) };
}

/**
 * Rotation matrix for yaw (about up, positive turns towards right), pitch (about right, positive turns up) and roll
 * (about f, positive turns up towards right), applied in that order, in the (f, right, up) basis; columns = new legs.
 * @param {number} yaw @param {number} pitch @param {number} roll
 */
export function attitudeMatrix(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  /** @type {(A: number[][], B: number[][]) => number[][]} */
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  // basis (f, right, up): yaw mixes f and right; pitch mixes f and up; roll mixes right and up
  const Y = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]];
  const P = [[cp, 0, -sp], [0, 1, 0], [sp, 0, cp]];
  const R = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]];
  return mul(mul(Y, P), R);
}

/** @param {Frame} F @param {{yaw?: number, pitch?: number, roll?: number}} att */
export const withAttitude = (F, att) => rotateFrame(F, attitudeMatrix(att.yaw ?? 0, att.pitch ?? 0, att.roll ?? 0));

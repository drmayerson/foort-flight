// @ts-check
// Ship-frame redshift (plan 4.3). The tracer normalises each ray to p_t = 1 and records g_inf = E_inf / E_em for an
// observer at infinity. The ship, with 4-velocity u, sees
//   g_ship = (E_ship / E_inf) g_inf,  E_ship / E_inf = (-k.u) / (-k_t) = (p.u) / p_t,
// with p the past-directed momentum of the pixel's ray (k = -p). For the pinhole camera p = -u + n/D, so p.u = 1 and
//   s = E_ship / E_inf = 1 / p_t,
// the factor the display multiplies every crossing's g by (shaders/glsl/display.glsl does the same per pixel). It is
// also the shift of light from infinity (the sky): a static observer at r in Schwarzschild sees 1 / sqrt(1 - 2/r).

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/**
 * The factor s = E_ship / E_inf of a ray with past-directed momentum p, seen by observer u.
 * @param {Mat4} g @param {Vec4} p @param {Vec4} u
 */
export function shipShift(g, p, u) {
  const pt = g[0].reduce((s, gi, i) => s + gi * p[i], 0);
  return innerProduct(g, p, u) / pt;
}

/** Relativistic Doppler factor of a source seen at angle th from the velocity (flat space): gamma (1 + v cos th). */
export const dopplerFlat = (/** @type {number} */ v, /** @type {number} */ th) => (1 + v * Math.cos(th)) / Math.sqrt(1 - v * v);

/** Aberration (flat): direction angle th_rest in the rest frame -> angle seen by an observer moving with v. */
export const aberrate = (/** @type {number} */ v, /** @type {number} */ thRest) => Math.acos((Math.cos(thRest) + v) / (1 + v * Math.cos(thRest)));

// @ts-check
// Christoffel symbols of a stationary metric by 4th-order central differences in double precision (plan 4.2):
// only the three spatial derivatives (d_t g = 0), step h = 1e-4 x the local length scale (a compromise between the
// h^4 truncation and the 1e-16 / h rounding of the differences; checked against analytic Kerr symbols to ~1e-11).

import { inv4 } from './ksKerr.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/**
 * Gamma^mu_{alpha beta} at X (Gamma[mu][alpha][beta]) and the metric and its inverse there.
 * @param {(X: Vec4) => Mat4} g @param {Vec4} X @param {number} scale local length scale (e.g. the distance from the centre)
 */
export function christoffel(g, X, scale) {
  const h = 1e-4 * Math.max(scale, 1e-6);
  const g0 = g(X);
  const gi = inv4(g0);
  /** dg[k][a][b] = d_k g_ab, k = 0..3 (k = 0: zero) */
  const dg = [g0.map((row) => row.map(() => 0))];
  for (let k = 1; k < 4; k++) {
    const at = (/** @type {number} */ s) => { const Y = [...X]; Y[k] += s * h; return g(Y); };
    const p2 = at(2), p1 = at(1), m1 = at(-1), m2 = at(-2);
    dg.push(g0.map((row, a) => row.map((_, b) => (-p2[a][b] + 8 * p1[a][b] - 8 * m1[a][b] + m2[a][b]) / (12 * h))));
  }
  /** lowered: Gamma_{nu alpha beta} = (d_a g_nb + d_b g_na - d_n g_ab) / 2 */
  const G = [0, 1, 2, 3].map((m) => [0, 1, 2, 3].map((a) => [0, 1, 2, 3].map((b) => {
    let s = 0;
    for (let n = 0; n < 4; n++) s += gi[m][n] * 0.5 * (dg[a][n][b] + dg[b][n][a] - dg[n][a][b]);
    return s;
  })));
  return { G, g: g0, gi };
}

/** -Gamma^mu_ab v^a w^b @param {number[][][]} G @param {Vec4} v @param {Vec4} w */
export function gammaVW(G, v, w) {
  const out = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) {
    let s = 0;
    const Gm = G[m];
    for (let a = 0; a < 4; a++) { const va = v[a]; if (va === 0) continue; const row = Gm[a]; for (let b = 0; b < 4; b++) s += row[b] * va * w[b]; }
    out[m] = -s;
  }
  return out;
}

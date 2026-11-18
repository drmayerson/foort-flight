// @ts-check
// Tidal acceleration (plan 7.4): the tidal tensor E_ij = R_{a b c d} e_i^a u^b e_j^c u^d in the ship frame, from the
// Riemann tensor R^m_{n r s} = d_r G^m_{n s} - d_s G^m_{n r} + G^m_{r l} G^l_{n s} - G^m_{s l} G^l_{n r}, with the
// derivatives of the Christoffel symbols by central differences (step 1e-3 r on top of the symbols' own 1e-4 r).
// The relative acceleration of two points a distance xi apart along e_j is -E_ij xi (geodesic deviation).
// Check: Schwarzschild, static observer: radial eigenvalue -2M/r^3, transverse +M/r^3.

import { christoffel } from './christoffel.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/**
 * @param {(X: Vec4) => Mat4} g @param {Vec4} X @param {Vec4} u @param {Vec4[]} e triad @param {number} scale
 * @returns {{E: number[][], max: number, eigen: number[]}} E in the triad's components; its eigenvalues (ascending);
 * max = the largest |eigenvalue|
 */
export function tidalTensor(g, X, u, e, scale) {
  const h = 1e-3 * Math.max(scale, 1e-6);
  const base = christoffel(g, X, scale);
  const G = base.G, gm = base.g;
  /** dG[k][m][n][s] = d_k G^m_ns */
  const dG = [G.map((a) => a.map((b) => b.map(() => 0)))];
  for (let k = 1; k < 4; k++) {
    const at = (/** @type {number} */ s) => { const Y = [...X]; Y[k] += s * h; return christoffel(g, Y, scale).G; };
    const p = at(1), m = at(-1);
    dG.push(G.map((a, i) => a.map((b, j) => b.map((_, l) => (p[i][j][l] - m[i][j][l]) / (2 * h)))));
  }
  /** R^m_{n r s} contracted: Rv[m][r] = R^m_{n r s} u^n u^s */
  const Rv = [0, 1, 2, 3].map((m) => [0, 1, 2, 3].map((r) => {
    let sum = 0;
    for (let n = 0; n < 4; n++) for (let s = 0; s < 4; s++) {
      const w = u[n] * u[s];
      if (w === 0) continue;
      let R = dG[r][m][n][s] - dG[s][m][n][r];
      for (let l = 0; l < 4; l++) R += G[m][r][l] * G[l][n][s] - G[m][s][l] * G[l][n][r];
      sum += R * w;
    }
    return sum;
  }));
  // E_ij = g_am R^m_{n r s} u^n u^s e_i^a e_j^r
  const E = e.map((ei) => e.map((ej) => {
    let s = 0;
    for (let a = 0; a < 4; a++) for (let m = 0; m < 4; m++) for (let r = 0; r < 4; r++) s += ei[a] * gm[a][m] * Rv[m][r] * ej[r];
    return s;
  }));
  // symmetrise (numerical noise), largest |eigenvalue|
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const v = 0.5 * (E[i][j] + E[j][i]); E[i][j] = v; E[j][i] = v; }
  const eig = eigen3(E);
  return { E, max: Math.max(...eig.map(Math.abs)), eigen: eig };
}

/** eigenvalues of a symmetric 3 x 3 (closed form) @param {number[][]} A */
export function eigen3(A) {
  const p1 = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
  const q = (A[0][0] + A[1][1] + A[2][2]) / 3;
  if (p1 < 1e-300) return [A[0][0], A[1][1], A[2][2]].sort((a, b) => a - b);
  const p2 = (A[0][0] - q) ** 2 + (A[1][1] - q) ** 2 + (A[2][2] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const B = A.map((row, i) => row.map((v, j) => (v - (i === j ? q : 0)) / p));
  const detB = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  const r = Math.max(-1, Math.min(1, detB / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
  return [e3, 3 * q - e1 - e3, e1].sort((a, b) => a - b);
}

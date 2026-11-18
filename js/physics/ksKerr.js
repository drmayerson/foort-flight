// @ts-check
// Kerr in Cartesian Kerr-Schild coordinates (t, x, y, z), M = 1: the ship's coordinates (plan 4.2). Horizon
// penetrating and regular on the axis. g = eta + f l (x) l with
//   f = 2 r^3 / (r^4 + a^2 z^2),  l = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z / r),
// r defined by x^2 + y^2 + z^2 = r^2 + a^2 (1 - z^2 / r^2). The relation to Boyer-Lindquist (the tracer's coordinates):
//   x + i y = (r + i a) sin(theta) e^{i phi_KS},  z = r cos(theta),
//   dt_KS = dt_BL + 2 r / Delta dr,  dphi_KS = dphi_BL + a / Delta dr,  Delta = r^2 - 2 r + a^2.
// Verified numerically against the vendored BL metric (J^T g_KS J = g_BL; dev/tests/unit/g2physics.test.js).

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/** Boyer-Lindquist r of a Cartesian KS point. @param {number} x @param {number} y @param {number} z @param {number} a */
export function ksR(x, y, z, a) {
  const R2 = x * x + y * y + z * z, a2 = a * a;
  const h = 0.5 * (R2 - a2);
  const r2 = h + Math.sqrt(h * h + a2 * z * z);
  return Math.sqrt(Math.max(r2, 0));
}

/** @param {number} a */
export function createKerrKS(a) {
  const rp = 1 + Math.sqrt(1 - a * a), rm = 1 - Math.sqrt(1 - a * a);
  // integrals of 2 r / Delta and a / Delta in r (outside the horizon, r > r+)
  const It = (/** @type {number} */ r) => (rp - rm > 1e-12)
    ? (2 * rp * Math.log(r - rp) - 2 * rm * Math.log(Math.abs(r - rm))) / (rp - rm)
    : 2 * Math.log(r - 1) - 2 / (r - 1);
  const Iphi = (/** @type {number} */ r) => (rp - rm > 1e-12) ? a / (rp - rm) * Math.log((r - rp) / Math.abs(r - rm)) : -a / (r - 1);

  return {
    a, rp, rm,

    /** covariant metric at (t, x, y, z) @param {Vec4} X @returns {Mat4} */
    g(X) {
      const [, x, y, z] = X;
      const r = ksR(x, y, z, a), r2 = r * r, a2 = a * a;
      const f = 2 * r2 * r / (r2 * r2 + a2 * z * z);
      const l = [1, (r * x + a * y) / (r2 + a2), (r * y - a * x) / (r2 + a2), z / r];
      const eta = [-1, 1, 1, 1];
      return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? eta[i] : 0) + f * l[i] * l[j]));
    },

    r: (/** @type {Vec4} */ X) => ksR(X[1], X[2], X[3], a),

    /** KS (t, x, y, z) -> BL (t, r, theta, phi) (outside the horizon) @param {Vec4} X @returns {Vec4} */
    toBL(X) {
      const [t, x, y, z] = X;
      const r = ksR(x, y, z, a);
      const th = Math.acos(Math.max(-1, Math.min(1, z / r)));
      const phiKS = Math.atan2(y, x) - Math.atan2(a, r);
      return [t - It(r), r, th, phiKS - Iphi(r)];
    },

    /** BL (t, r, theta, phi) -> KS (t, x, y, z) @param {Vec4} B @returns {Vec4} */
    fromBL(B) {
      const [t, r, th, phi] = B;
      const phiKS = phi + Iphi(r), s = Math.sin(th);
      return [t + It(r), (r * Math.cos(phiKS) - a * Math.sin(phiKS)) * s, (r * Math.sin(phiKS) + a * Math.cos(phiKS)) * s, r * Math.cos(th)];
    },

    /**
     * Jacobian d(BL)/d(KS) at X (row i = BL coordinate, column j = KS coordinate), analytic:
     * r, theta, phi_KS from the Cartesian point, then t_BL = t - It(r), phi_BL = phi_KS - Iphi(r).
     * @param {Vec4} X @returns {Mat4}
     */
    jacobianToBL(X) {
      const [, x, y, z] = X;
      const r = ksR(x, y, z, a), r2 = r * r, a2 = a * a;
      // r from R^2 = r^2 + a^2 - a^2 z^2 / r^2 (implicit): dr = (x dx + y dy + z dz (1 + a^2 / r^2)) / (r + a^2 z^2 / r^3)
      const den = r + a2 * z * z / (r2 * r);
      const dr = [0, x / den, y / den, z * (1 + a2 / r2) / den];
      // cos(theta) = z / r
      const ct = z / r, st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const dct = [0, -z / r2 * dr[1], -z / r2 * dr[2], 1 / r - z / r2 * dr[3]];
      const dth = dct.map((v) => -v / st);
      // phi_KS = atan2(y, x) - atan2(a, r)
      const rho2 = x * x + y * y;
      const datan = [0, -y / rho2, x / rho2, 0];
      const dAr = (-a / (r2 + a2));   // d/dr atan2(a, r)
      const dphiKS = datan.map((v, j) => v - dAr * dr[j]);
      const Delta = r2 - 2 * r + a2;
      const dt = [1, ...[1, 2, 3].map((j) => -2 * r / Delta * dr[j])];
      const dphi = dphiKS.map((v, j) => v - a / Delta * dr[j]);
      return [dt, dr, dth, dphi];
    },
  };
}

/** 4x4 inverse (Gauss-Jordan, partial pivoting) @param {Mat4} M @returns {Mat4} */
export function inv4(M) {
  const A = M.map((row, i) => [...row, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let i = c + 1; i < 4; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 8; j++) A[c][j] /= d;
    for (let i = 0; i < 4; i++) if (i !== c) { const f = A[i][c]; for (let j = 0; j < 8; j++) A[i][j] -= f * A[c][j]; }
  }
  return A.map((row) => row.slice(4));
}

/** y = M v @param {Mat4} M @param {Vec4} v */
export const matVec = (M, v) => M.map((row) => row.reduce((s, m, j) => s + m * v[j], 0));

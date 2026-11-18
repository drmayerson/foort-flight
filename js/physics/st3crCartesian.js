// @ts-check
// The ST3Cr fuzzball (and its lambda = 0 black hole) in Cartesian coordinates of the flat base (plan 4.2):
//   (x, y, z) = r (sin th cos ph, sin th sin ph, cos th),
//   ds^2 = -N (dt + W (x dy - y dx))^2 + P (dx^2 + dy^2 + dz^2),
// with, from the vendored g_dd (units of M_ADM = 1): N = -g_tt (= Q^{-1/2}), P = g_rr (= Q^{1/2}),
// W = omega / (x^2 + y^2), omega = g_tphi / g_tt. The base is conformally flat (g_thth = r^2 g_rr) and omega ~ sin^2 th
// on the axis, so W stays finite there; both are checked numerically in the tests.

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/**
 * @param {import('../../vendor/foort-gpu/js/metrics/common.js').StationaryAxisymmetricMetric} m the vendored (unit-mass) metric
 */
export function createBaseCartesian(m) {
  /** N, P, W at a base point; theta kept off the axis by 1e-9 as the vendored metrics do */
  const fields = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const rho = Math.hypot(x, y), r = Math.hypot(rho, z);
    const th = Math.min(Math.max(Math.atan2(rho, z), 1e-9), Math.PI - 1e-9);
    const g = m.g_dd(r, th);
    const omega = g.gtphi / g.gtt;
    const s = Math.sin(th);
    return { N: -g.gtt, P: g.grr, W: omega / (r * r * s * s), r, th };
  };
  return {
    fields,

    /** covariant metric at (t, x, y, z) @param {Vec4} X @returns {Mat4} */
    g(X) {
      const [, x, y, z] = X;
      const { N, P, W } = fields(x, y, z);
      // dt + W (x dy - y dx): one-form k = (1, -W y, W x, 0)
      const k = [1, -W * y, W * x, 0];
      const d = [0, P, P, P];
      return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => -N * k[i] * k[j] + (i === j ? d[i] : 0)));
    },

    r: (/** @type {Vec4} */ X) => Math.hypot(X[1], X[2], X[3]),

    /** (t, x, y, z) -> tracer (t, r, theta, phi) @param {Vec4} X @returns {Vec4} */
    toSpherical(X) {
      const [t, x, y, z] = X;
      const r = Math.hypot(x, y, z);
      return [t, r, Math.acos(Math.max(-1, Math.min(1, z / r))), Math.atan2(y, x)];
    },

    /** @param {Vec4} B @returns {Vec4} */
    fromSpherical(B) {
      const [t, r, th, ph] = B;
      return [t, r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
    },

    /** d(t, r, theta, phi)/d(t, x, y, z) (singular on the axis) @param {Vec4} X @returns {Mat4} */
    jacobianToSpherical(X) {
      const [, x, y, z] = X;
      const rho2 = x * x + y * y, rho = Math.sqrt(rho2), r2 = rho2 + z * z, r = Math.sqrt(r2);
      return [
        [1, 0, 0, 0],
        [0, x / r, y / r, z / r],
        [0, x * z / (r2 * rho), y * z / (r2 * rho), -rho / r2],
        [0, -y / rho2, x / rho2, 0],
      ];
    },
  };
}

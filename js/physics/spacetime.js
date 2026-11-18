// @ts-check
// A spacetime of the game: the vendored metric in the tracer's coordinates (t, r, theta, phi) (Boyer-Lindquist for
// Kerr, the flat base's spherical coordinates for ST3Cr) and the ship's coordinates (t, x, y, z) (Cartesian
// Kerr-Schild for Kerr, the base's Cartesian coordinates for ST3Cr), with the maps between them (plan 4.2).
//
// Vectors at a point map with the Jacobian J = d(tracer)/d(ship): v_tracer = J v_ship.

import { createMetric, metricEntry } from '../../vendor/foort-gpu/js/metrics/registry.js';
import { toMat4, inverseMetric } from '../../vendor/foort-gpu/js/metrics/common.js';
import { createKerrKS, inv4, matVec } from './ksKerr.js';
import { createBaseCartesian } from './st3crCartesian.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 */

/**
 * @param {'kerr'|'st3cr'|'st3crBH'} id @param {Record<string, number>} params (Kerr: {a}; ST3Cr: {lambda}, P = 2, q0 = 50)
 */
export function createSpacetime(id, params) {
  const full = id === 'kerr' ? { a: params.a } : { P: 2, q0: 50, ...params };
  const metric = createMetric(id, full);
  const entry = metricEntry(id);
  const gTracer = (/** @type {number} */ r, /** @type {number} */ th) => toMat4(metric.g_dd(r, th));
  const gTracerInv = (/** @type {number} */ r, /** @type {number} */ th) => toMat4(inverseMetric(metric)(r, th));
  /** horizon radius (tracer r) for Kerr; 0 otherwise */
  const rHorizon = metric.horizon.kind === 'sphere' ? metric.horizon.r : 0;

  if (id === 'kerr') {
    const ks = createKerrKS(params.a);
    return {
      id, params: full, metric, entry, rHorizon, shipName: 'Kerr-Schild',
      gTracer, gTracerInv,
      gShip: ks.g,
      rShip: ks.r,
      /** @param {Vec4} X */ toTracer: (X) => ks.toBL(X),
      /** @param {Vec4} B */ fromTracer: (B) => ks.fromBL(B),
      /** @param {Vec4} X */ jacobian: (X) => ks.jacobianToBL(X),
      /** vector at X: ship -> tracer components @param {Vec4} X @param {Vec4} v */
      vecToTracer: (X, v) => matVec(ks.jacobianToBL(X), v),
      /** vector at X: tracer -> ship components @param {Vec4} X @param {Vec4} v */
      vecToShip: (X, v) => matVec(inv4(ks.jacobianToBL(X)), v),
    };
  }
  const base = createBaseCartesian(metric);
  return {
    id, params: full, metric, entry, rHorizon, shipName: 'base Cartesian',
    gTracer, gTracerInv,
    gShip: base.g,
    rShip: base.r,
    /** @param {Vec4} X */ toTracer: (X) => base.toSpherical(X),
    /** @param {Vec4} B */ fromTracer: (B) => base.fromSpherical(B),
    /** @param {Vec4} X */ jacobian: (X) => base.jacobianToSpherical(X),
    /** @param {Vec4} X @param {Vec4} v */ vecToTracer: (X, v) => matVec(base.jacobianToSpherical(X), v),
    /** @param {Vec4} X @param {Vec4} v */ vecToShip: (X, v) => matVec(inv4(base.jacobianToSpherical(X)), v),
  };
}

/** @typedef {ReturnType<typeof createSpacetime>} Spacetime */

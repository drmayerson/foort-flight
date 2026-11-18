// @ts-check
// Camera of a ship (or free-mode observer) given in the ship's coordinates (plan 4.2-4.3): event X = (t, x, y, z) and
// frame (u, f, right, up) as vectors in ship coordinates -> the tracer's event, frame and camera uniforms, via the
// spacetime's map and Jacobian (Kerr-Schild -> Boyer-Lindquist; base Cartesian -> spherical).

import { pinholeUniforms } from './generalTetrad.js';
import { observer, baseFrame, withAttitude } from '../physics/observers.js';
import { boostFrame } from './generalTetrad.js';

/** @typedef {number[]} Vec4 @typedef {import('./generalTetrad.js').Frame} Frame */
/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime */

/**
 * Frame vectors ship -> tracer coordinates at X. @param {Spacetime} S @param {Vec4} X @param {Frame} F @returns {Frame}
 */
export function frameToTracer(S, X, F) {
  return { u: S.vecToTracer(X, F.u), f: S.vecToTracer(X, F.f), right: S.vecToTracer(X, F.right), up: S.vecToTracer(X, F.up) };
}

/** @param {Spacetime} S @param {Vec4} X @param {Frame} F @returns {Frame} */
export function frameToShip(S, X, F) {
  return { u: S.vecToShip(X, F.u), f: S.vecToShip(X, F.f), right: S.vecToShip(X, F.right), up: S.vecToShip(X, F.up) };
}

/**
 * The tracer camera of a ship state.
 * @param {Spacetime} S @param {Vec4} X ship event @param {Frame} F ship frame (ship coordinates) @param {number} fov rad
 */
export function shipCamera(S, X, F, fov) {
  const pos = S.toTracer(X);
  const [, r, th] = pos;
  const gdd = S.gTracer(r, th);
  const frame = frameToTracer(S, X, F);
  const cam = pinholeUniforms({ gdd, position: pos, r0: S.rHorizon, frame, fov });
  return { ...cam, position: pos, frame, gdd };
}

/** @typedef {'none'|'look'|'radialIn'|'radialOut'|'prograde'|'retrograde'|'north'|'south'} BoostDir */

/**
 * A free-mode observer state in ship coordinates: an observer family at tracer (r, theta, phi), boosted with speed v
 * along a direction of its base frame, then turned by an attitude (the attitude also turns the boost direction 'look').
 * Returns null (with the reason) where the family does not exist.
 * @param {Spacetime} S
 * @param {{kind: import('../physics/observers.js').ObserverKind, r: number, theta: number, phi?: number, t?: number,
 *          v?: number, dir?: BoostDir, yaw?: number, pitch?: number, roll?: number}} o
 */
export function observerState(S, o) {
  const ob = observer(o.kind, S.gTracer, o.r, o.theta);
  if (!ob.u) return { X: null, F: null, reason: /** @type {any} */ (ob).reason };
  const g = S.gTracer(o.r, o.theta);
  let F = baseFrame(g, ob.u);   // f = -r^, right = phi^, up = -theta^
  const v = o.v ?? 0;
  if (v > 0 && o.dir && o.dir !== 'none') {
    // directions in the base triad (f = inward, right = +phi, up = north)
    const att0 = withAttitude(F, { yaw: o.yaw ?? 0, pitch: o.pitch ?? 0 });
    /** @type {Record<string, Vec4>} */
    const legs = { radialIn: [1, 0, 0], radialOut: [-1, 0, 0], prograde: [0, 1, 0], retrograde: [0, -1, 0], north: [0, 0, 1], south: [0, 0, -1] };
    let w = legs[o.dir];
    if (o.dir === 'look') {
      // the look direction of the attitude, in base-triad components
      const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => a.reduce((s, x, i) => s + x * g[i].reduce((t, gij, j) => t + gij * b[j], 0), 0);
      w = [ip(att0.f, F.f), ip(att0.f, F.right), ip(att0.f, F.up)];
    }
    F = boostFrame(F, w.map((c) => c * v));
  }
  F = withAttitude(F, { yaw: o.yaw ?? 0, pitch: o.pitch ?? 0, roll: o.roll ?? 0 });
  const X = S.fromTracer([o.t ?? 0, o.r, o.theta, o.phi ?? 0]);
  return { X, F: frameToShip(S, X, F), reason: '' };
}

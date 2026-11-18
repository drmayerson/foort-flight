// @ts-check
// The cubemap's reference observer and the map from the ship's frame to it (plan 5.2).
//
// A cubemap is traced for a reference observer at tracer (t_c, r_c, theta_c, phi_c): the local ZAMO frame boosted by
// the ship's ZAMO-frame velocity at the time of the refresh (so aberration is already in the cubemap and the needed
// resolution stays near the screen's). For display, a ray's components in the ship frame go
//   ship frame -> the ZAMO frame at the ship -> (identified with) the ZAMO frame at the reference -> reference frame,
// one 4x4 matrix M per frame. ZAMO frames at different (t, phi) are related by the spacetime's symmetries, so the
// identification is exact when (r, theta) agree; otherwise it is the cubemap's staleness. The frames' components are
// ordered (u, f, right, up), metric signature (-, +, +, +).

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { zamo, baseFrame } from './observers.js';
import { boostFrame, cubeFaceFrames, pinholeUniforms } from '../camera/generalTetrad.js';

/** @typedef {number[]} Vec4 @typedef {number[][]} Mat4 @typedef {import('../camera/generalTetrad.js').Frame} Frame */

const ETA = [-1, 1, 1, 1];
const legs = (/** @type {Frame} */ F) => [F.u, F.f, F.right, F.up];

/** components of frame B's legs in frame A: C[a][b] = eta_a g(A_a, B_b) @param {Mat4} g @param {Frame} A @param {Frame} B */
function frameMatrix(g, A, B) {
  const a = legs(A), b = legs(B);
  return a.map((ai, i) => b.map((bj) => ETA[i] * innerProduct(g, ai, bj)));
}
const mul = (/** @type {Mat4} */ A, /** @type {Mat4} */ B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));

/** The local ZAMO base frame at tracer (r, theta). @param {Mat4} g */
export function zamoFrame(g) {
  const z = zamo(g);
  if (!z) throw new Error('no ZAMO here');
  return baseFrame(g, z.u);
}

/**
 * The reference frame for a ship state: the ZAMO frame at the ship boosted by the ship's ZAMO-frame velocity.
 * @param {Mat4} g metric at the ship (tracer coordinates) @param {Frame} ship ship frame (tracer coordinates)
 * @returns {{frame: Frame, v: number[]}} v = velocity in the ZAMO triad (f, right, up)
 */
export function referenceFrame(g, ship) {
  const Z = zamoFrame(g);
  const uZ = frameMatrix(g, Z, ship).map((row) => row[0]);   // the ship's u in ZAMO components (gamma, gamma v)
  const v = [uZ[1] / uZ[0], uZ[2] / uZ[0], uZ[3] / uZ[0]];
  return { frame: boostFrame(Z, v), v };
}

/**
 * The display map of a frame: M (ship-frame components -> reference-frame components, column-major for GLSL) and
 * refT = (-u_t, f_t, right_t, up_t) of the reference frame (p_t of a unit-energy ray is dot((1, d), refT)).
 * @param {Mat4} gShip metric at the ship @param {Frame} ship ship frame @param {Mat4} gRef metric at the reference
 * @param {Frame} ref reference frame (its own ZAMO frame boosted, as referenceFrame returns)
 * @param {number[]} vRef its velocity in its ZAMO triad
 */
export function shipToReference(gShip, ship, gRef, ref, vRef) {
  const A = frameMatrix(gShip, zamoFrame(gShip), ship);          // ship components -> ZAMO components (ship's point)
  const Zr = zamoFrame(gRef);
  const B = frameMatrix(gRef, ref, Zr);                          // ZAMO components -> reference components
  const M = mul(B, A);
  const colMajor = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) colMajor.push(M[i][j]);
  const t = (/** @type {Vec4} */ v) => gRef[0].reduce((s, gi, i) => s + gi * v[i], 0);
  const refT = [-t(ref.u), t(ref.f), t(ref.right), t(ref.up)];
  return { M, colMajor, refT, vRef };
}

/**
 * Staleness of a cubemap for the current ship (a dimensionless measure for the refresh policy and the HUD):
 * the displacement in (r, theta) relative to r (in radians of view), and the relative speed between the ship and the
 * reference frame (aberration change), from M's time row: gamma_rel = -M[0][0]... = E_ref of p = (-1, 0).
 * @param {{r: number, theta: number}} ship @param {{r: number, theta: number}} ref @param {Mat4} M
 */
export function staleness(ship, ref, M) {
  const dr = Math.abs(ship.r - ref.r) / Math.max(ship.r, 1e-9), dth = Math.abs(ship.theta - ref.theta);
  const gammaRel = M[0][0];   // u_ship in reference components: (gamma, ...) -> its time component
  return { pos: Math.hypot(dr, dth), vel: Math.sqrt(Math.max(0, gammaRel * gammaRel - 1)) / Math.max(gammaRel, 1), gammaRel };
}

/**
 * Tracer uniforms of the six cube faces in one atlas (3N x 2N; face k at ((k mod 3) N, (k div 3) N)): per face the
 * pinhole camera (90 degrees) and uScreen rescaled so that the atlas pixels of the face map to its screen.
 * @param {{gdd: Mat4, position: Vec4, r0: number, frame: Frame, N: number}} o
 */
export function cubeFaceCameras(o) {
  const W = 3 * o.N, H = 2 * o.N;
  return cubeFaceFrames(o.frame).map((F, k) => {
    const cam = pinholeUniforms({ gdd: o.gdd, position: o.position, r0: o.r0, frame: F, fov: Math.PI / 2 });
    const sf = cam.uScreen[1][2];   // face screen size 2 r_c
    const ox = (k % 3) * o.N, oy = Math.floor(k / 3) * o.N;
    cam.uScreen = ['4f', [sf * (W / (2 * o.N) - ox / o.N - 0.5), sf * (H / (2 * o.N) - oy / o.N - 0.5), sf * W / o.N, sf * H / o.N]];
    return { ...cam, rect: { x: ox, y: oy, w: o.N, h: o.N } };
  });
}

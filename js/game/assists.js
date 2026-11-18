// @ts-check
// Flight assists (plan 7.3), pure functions of the spacetime and the ship state (ship coordinates), each returning the
// thrust (body components: forward, right, up) and/or an attitude rotation for this frame, a status for the HUD
// (assists never act silently), and whether they are done. Thrust is limited to the player's maximum.
//   point:  turn the forward axis towards prograde / retrograde (motion relative to the local ZAMO), radially in or
//           out (in = towards the hole), and hold it there until switched off
//   hover:  hold the current spot: static-observer acceleration plus a critically damped correction of position and
//           velocity relative to the static observer (hovering is unstable without it). Unavailable where no static
//           observer exists (Kerr's ergoregion: even infinite thrust cannot hold a ship still there).
//   circularize: steer towards the circular-orbit 4-velocity at the current radius (equatorial plane only)
//   matchZamo:   steer towards the local ZAMO's 4-velocity

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { observer, baseFrame, zamo } from '../physics/observers.js';
import { staticAcceleration } from '../physics/ship.js';
import { christoffel, gammaVW } from '../physics/christoffel.js';

/** @typedef {number[]} Vec4 @typedef {import('../physics/spacetime.js').Spacetime} Spacetime */
/** @typedef {import('../physics/ship.js').ShipState} ShipState */
/** @typedef {{acc: number[], rot: number[]|null, status: string, done: boolean, error?: string, angle?: number}} AssistOut */

export const ASSISTS = /** @type {Record<string, string>} */ ({
  kill: 'kill rotation', prograde: 'point prograde', retrograde: 'point retrograde', radialIn: 'point at the hole', radialOut: 'point away from the hole',
  hover: 'hover here', circularize: 'circularize', matchZamo: 'match the ZAMO',
});
/** number keys (plan 7.2) */
export const ASSIST_KEYS = /** @type {Record<string, string>} */ ({ 1: 'kill', 2: 'prograde', 3: 'retrograde', 4: 'radialIn', 5: 'radialOut', 6: 'hover', 7: 'circularize', 8: 'matchZamo' });

const ip = (/** @type {number[][]} */ g, /** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(g, a, b);
/** the part of a vector orthogonal to u (u.u = -1) @param {number[][]} g @param {Vec4} v @param {Vec4} u */
const perp = (g, v, u) => { const k = ip(g, v, u); return v.map((x, i) => x + k * u[i]); };
/** body components of a vector @param {number[][]} g @param {Vec4} v @param {ShipState} s */
const body = (g, v, s) => s.e.map((e) => ip(g, v, e));
/** clamp a body vector to a length @param {number[]} a @param {number} max */
const clamp = (a, max) => { const n = Math.hypot(a[0], a[1], a[2]); return n > max ? a.map((x) => x * max / n) : a; };

/**
 * The velocity of an observer w as the ship sees it (spatial, ship rest frame, in coordinates): (w + (w.u) u) / gamma.
 * @param {number[][]} g @param {Vec4} w @param {Vec4} u
 */
function relVelocity(g, w, u) {
  const gam = -ip(g, w, u);
  return perp(g, w, u).map((x) => x / gam);
}

/**
 * The ZAMO's proper acceleration at X, in ship coordinates: in the tracer's coordinates the ZAMO field has no r or
 * theta components and its components depend on (r, theta) only, so a^mu = Gamma^mu_ab u^a u^b there.
 * @param {Spacetime} S @param {Vec4} X @param {Vec4} uT the ZAMO (tracer coordinates)
 */
function zamoAcceleration(S, X, uT) {
  const B = S.toTracer(X);
  const { G } = christoffel((Y) => S.gTracer(Y[1], Y[2]), B, B[1]);
  return S.vecToShip(X, gammaVW(G, uT, uT).map((v) => -v));
}

/** the local ZAMO and base frame in ship coordinates @param {Spacetime} S @param {Vec4} X */
function zamoShip(S, X) {
  const B = S.toTracer(X);
  const gT = S.gTracer(B[1], B[2]);
  const z = zamo(gT);
  if (!z) return null;
  const F = baseFrame(gT, z.u);
  return { u: S.vecToShip(X, z.u), uT: z.u, f: S.vecToShip(X, F.f), right: S.vecToShip(X, F.right), up: S.vecToShip(X, F.up), B };
}

/**
 * Rotation (body axis * angle) that turns the forward axis towards a target direction by at most `maxAngle`.
 * @param {number[]} tb target in body components
 * @param {number} maxAngle
 */
function turnTowards(tb, maxAngle) {
  const n = Math.hypot(tb[0], tb[1], tb[2]);
  if (!(n > 0)) return { rot: null, angle: 0 };
  const t = tb.map((x) => x / n);
  const angle = Math.acos(Math.max(-1, Math.min(1, t[0])));
  // axis = forward x target = (1, 0, 0) x t = (0, -t2, t1)
  let ax = [0, -t[2], t[1]];
  const an = Math.hypot(ax[1], ax[2]);
  if (an < 1e-12) ax = angle > 1 ? [0, 0, 1] : [0, 0, 0]; else ax = ax.map((x) => x / an);
  const step = Math.min(angle, maxAngle);
  return { rot: ax.map((x) => x * step), angle };
}

/**
 * One assist step.
 * @param {string} id
 * @param {Spacetime} S @param {ShipState} s
 * @param {{maxThrust: number, maxTurn: number, target?: number[]}} o maxTurn: the attitude change allowed this frame
 *        (rad); target: hover's spot (tracer t, r, theta, phi), set when engaged
 * @returns {AssistOut}
 */
export function assistStep(id, S, s, o) {
  const g = S.gShip(s.X);
  const none = { acc: [0, 0, 0], rot: null };
  if (id === 'kill') return { ...none, status: 'rotation stopped', done: true };
  const Z = zamoShip(S, s.X);
  if (!Z) return { ...none, status: '', done: true, error: 'no ZAMO here' };
  if (id === 'prograde' || id === 'retrograde' || id === 'radialIn' || id === 'radialOut') {
    let d;
    if (id === 'prograde' || id === 'retrograde') {
      // our motion relative to the ZAMO = minus the ZAMO's velocity seen from the ship
      d = relVelocity(g, Z.u, s.u).map((x) => (id === 'prograde' ? -x : x));
      if (Math.sqrt(Math.max(ip(g, d, d), 0)) < 1e-9) return { ...none, status: `${ASSISTS[id]}: no motion relative to the ZAMO`, done: true };
    } else {
      d = perp(g, Z.f, s.u).map((x) => (id === 'radialIn' ? x : -x));
    }
    const t = turnTowards(body(g, d, s), o.maxTurn);
    // pointing holds (the target turns as the ship moves): it stays on until switched off
    return { acc: [0, 0, 0], rot: t.rot, status: `${ASSISTS[id]}: ${t.angle < 0.01 ? 'holding' : `${(t.angle * 180 / Math.PI).toFixed(1)}° to go`}`, done: false, angle: t.angle };
  }
  if (id === 'hover') {
    const B = Z.B;
    const st = observer('static', S.gTracer, B[1], B[2]);
    if (!st.u) return { ...none, status: '', done: true, error: 'hover unavailable: inside the ergoregion no static observer exists; even infinite thrust cannot hold a ship still against the frame dragging' };
    const sa = /** @type {NonNullable<ReturnType<typeof staticAcceleration>>} */ (staticAcceleration(S, s.X));
    if (sa.norm > o.maxThrust) return { ...none, status: '', done: true, error: `hover needs ${sa.norm.toPrecision(3)} c⁴/GM of thrust, more than the maximum ${o.maxThrust.toPrecision(3)}` };
    const gT = S.gTracer(B[1], B[2]);
    const F = baseFrame(gT, st.u);
    const legs = [F.f.map((x) => -x), F.up.map((x) => -x), F.right].map((v) => S.vecToShip(s.X, v));   // r^, theta^, phi^
    const uS = S.vecToShip(s.X, st.u);
    const v = relVelocity(g, s.u, uS);   // ship velocity relative to the static observer
    const vel = legs.map((L) => ip(g, v, L));
    const tg = o.target ?? B;
    let dphi = B[3] - tg[3]; dphi = ((dphi + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const disp = [Math.sqrt(gT[1][1]) * (B[1] - tg[1]), Math.sqrt(gT[2][2]) * (B[2] - tg[2]), Math.sqrt(gT[3][3]) * dphi];
    const w0 = 0.3;   // correction rate (1/M): critically damped
    const corr = disp.map((d, i) => -w0 * w0 * d - 2 * w0 * vel[i]);
    const a = sa.a.map((x, m) => x + corr[0] * legs[0][m] + corr[1] * legs[1][m] + corr[2] * legs[2][m]);
    const acc = clamp(body(g, perp(g, a, s.u), s), o.maxThrust);
    const err = Math.hypot(...disp);
    return { acc, rot: null, status: `hover here: ${(Math.hypot(acc[0], acc[1], acc[2])).toPrecision(3)} c⁴/GM, off by ${err.toExponential(1)} M`, done: false };
  }
  if (id === 'circularize' || id === 'matchZamo') {
    let target = Z.u;
    if (id === 'circularize') {
      const B = Z.B;
      if (Math.abs(B[2] - Math.PI / 2) > 0.02) return { ...none, status: '', done: true, error: 'circularize: circular orbits exist only in the equatorial plane (get within 1° of it first)' };
      const Lz = ip(g, [0, -s.X[2], s.X[1], 0], s.u);
      const ob = observer(Lz >= 0 ? 'circularPro' : 'circularRetro', S.gTracer, B[1], Math.PI / 2);
      if (!ob.u) return { ...none, status: '', done: true, error: `circularize: ${/** @type {any} */ (ob).reason}` };
      // the orbit's 4-velocity at the ship's own theta (normalised there), so that it is a unit vector at the ship
      const gT = S.gTracer(B[1], B[2]);
      const uT = ob.u.map((x) => x / Math.sqrt(-innerProduct(gT, ob.u, ob.u)));
      target = S.vecToShip(s.X, uT);
    }
    const v = relVelocity(g, target, s.u);
    const vb = body(g, v, s);
    const vmag = Math.hypot(vb[0], vb[1], vb[2]);
    const k = 0.5;   // 1/M: the velocity difference decays on ~2 M (if the thrust allows)
    // the ZAMO is not in free fall: add its own acceleration (feed-forward), or gravity keeps reopening the gap
    const ff = id === 'matchZamo' ? body(g, perp(g, zamoAcceleration(S, s.X, Z.uT), s.u), s) : [0, 0, 0];
    const acc = clamp(vb.map((x, i) => k * x + ff[i]), o.maxThrust);
    const done = vmag < 2e-7;
    return { acc: done ? [0, 0, 0] : acc, rot: null, status: `${ASSISTS[id]}: Δv ${vmag.toExponential(1)} c`, done };
  }
  return { ...none, status: '', done: true, error: `unknown assist ${id}` };
}

/**
 * Rotate the ship's triad by a body rotation vector (axis * angle, components on forward, right, up): exact rotation
 * within the rest frame (the attitude does not affect the dynamics except through the thrust's direction).
 * @param {ShipState} s @param {number[]} rv
 * @returns {ShipState}
 */
export function rotateTriad(s, rv) {
  const ang = Math.hypot(rv[0], rv[1], rv[2]);
  if (!(ang > 0)) return s;
  const k = rv.map((x) => x / ang), c = Math.cos(ang), sn = Math.sin(ang);
  // each new leg = R applied to the old legs; R (body) by Rodrigues: v' = v c + (k x v) s + k (k.v)(1 - c)
  const R = [0, 1, 2].map((i) => {
    const v = [0, 0, 0]; v[i] = 1;
    const kv = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    const kd = k[i];
    return [0, 1, 2].map((j) => v[j] * c + kv[j] * sn + k[j] * kd * (1 - c));
  });
  const e = R.map((row) => [0, 1, 2, 3].map((m) => row[0] * s.e[0][m] + row[1] * s.e[1][m] + row[2] * s.e[2][m]));
  return { ...s, e };
}

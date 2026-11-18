// @ts-check
// Ship dynamics (plan 4.4; G5), in proper time tau, in the ship's coordinates (Kerr-Schild / base Cartesian), double
// precision on the CPU:
//   dx^mu/dtau  = u^mu
//   du^mu/dtau  = -Gamma^mu_ab u^a u^b + a^mu,        a^mu = sum_i a_i e_(i)^mu (thrust in the ship frame; a.u = 0)
//   de_(i)/dtau = -Gamma^mu_ab u^a e_(i)^b + a_i u^mu + Omega_ij e_(j)   (Fermi-Walker transport + attitude rotation)
// with Omega e_i = w x e_i for the body rotation rate w (rad per M of proper time, the reaction wheels; components on
// the right-handed triad (forward, right, up)).
// Integrator: Dormand-Prince 5(4), FSAL, error control on the event (relative to the distance from the centre) and on
// u; the triad follows. Every 10 steps u is renormalised and the triad re-orthonormalised (u first, then Gram-Schmidt).
// Ending events (plan 4.2, F2, F3): the Kerr horizon (r < r+ (1 + 0.01)), the lambda = 0 throat (r < r_cut), contact
// with a fuzzball singularity, escape (r > 2000 M), and numerical failure (the last good state is kept).

import { christoffel, gammaVW } from './christoffel.js';
import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';

/** @typedef {number[]} Vec4 @typedef {import('./spacetime.js').Spacetime} Spacetime */

/**
 * @typedef {Object} ShipState
 * @property {number} tau           proper time (M)
 * @property {Vec4} X               event (t, x, y, z)
 * @property {Vec4} u               4-velocity
 * @property {Vec4[]} e             spatial triad (forward, right, up): e[0] = forward (the camera's f), e[1] = right, e[2] = up
 * @property {number} dv            proper acceleration integrated so far (the delta-v spent)
 */

// Dormand-Prince 5(4) tableau
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
const N = 20;   // X 4, u 4, e 3 x 4

const pack = (/** @type {ShipState} */ s) => [...s.X, ...s.u, ...s.e[0], ...s.e[1], ...s.e[2]];
const unpack = (/** @type {number[]} */ y) => ({ X: y.slice(0, 4), u: y.slice(4, 8), e: [y.slice(8, 12), y.slice(12, 16), y.slice(16, 20)] });

/**
 * @param {Spacetime} S
 * @param {{tol?: number, rEscape?: number}} [o]
 */
export function createShipIntegrator(S, o = {}) {
  const tol = o.tol ?? 1e-10;
  const rEscape = o.rEscape ?? 2000;
  const rTerm = S.metric.terminationRadius?.() ?? 0;
  const singEps = S.metric.singularityEpsilon?.() ?? 0;
  const sings = S.metric.singularities?.() ?? [];
  let h = NaN;            // the step size carried between calls
  let stepsTotal = 0, rejected = 0, sinceOrtho = 0;

  /** right-hand side @param {number[]} y @param {number[]} acc body thrust @param {number[]} w body rotation rate */
  const rhs = (y, acc, w) => {
    const { X, u, e } = unpack(y);
    const { G } = christoffel(S.gShip, X, Math.max(S.rShip(X), 1e-3));
    const a4 = [0, 1, 2, 3].map((m) => acc[0] * e[0][m] + acc[1] * e[1][m] + acc[2] * e[2][m]);
    const du = gammaVW(G, u, u).map((v, m) => v + a4[m]);
    const out = [...u, ...du];
    for (let i = 0; i < 3; i++) {
      const de = gammaVW(G, u, e[i]).map((v, m) => v + acc[i] * u[m]);
      // body rotation w x e_i = sum_k w_k eps_kij e_j in the right-handed (forward, right, up) triad:
      // e_0' += w_2 e_1 - w_1 e_2, and cyclic
      const j = (i + 1) % 3, k = (i + 2) % 3;
      for (let m = 0; m < 4; m++) de[m] += w[k] * e[j][m] - w[j] * e[k][m];
      out.push(...de);
    }
    return out;
  };

  /** renormalise u and re-orthonormalise the triad @param {ShipState} s */
  const orthonormalise = (s) => {
    const g = S.gShip(s.X);
    const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(g, a, b);
    const u = s.u.map((x) => x / Math.sqrt(-ip(s.u, s.u)));
    /** @type {Vec4[]} */
    const e = [];
    for (let i = 0; i < 3; i++) {
      let v = s.e[i].map((x, m) => x + ip(s.e[i], u) * u[m]);
      for (const p of e) { const c = ip(v, p); v = v.map((x, m) => x - c * p[m]); }
      e.push(v.map((x) => x / Math.sqrt(ip(v, v))));
    }
    return { ...s, u, e };
  };

  /** the ending event at an event X, or '' @param {Vec4} X */
  const event = (X) => {
    if (!X.every(Number.isFinite)) return 'numerical';
    const r = S.rShip(X);
    if (S.id === 'kerr') {
      const rBL = S.toTracer(X)[1];
      if (!(rBL > S.rHorizon * 1.01)) return 'horizon';
    }
    if (S.id === 'st3crBH' && r < rTerm) return 'throat';
    if (S.id === 'st3cr') {
      for (const sg of sings) {
        const sx = sg.r * Math.sin(sg.theta), sz = sg.r * Math.cos(sg.theta);
        const d = sg.kind === 'ring' ? Math.hypot(Math.hypot(X[1], X[2]) - sx, X[3] - sz) : Math.hypot(Math.hypot(X[1], X[2]), X[3] - sz);
        if (d < Math.max(singEps, 1e-6)) return sg.kind === 'ring' ? 'singularity-ring' : 'singularity-center';
      }
      if (r < rTerm) return 'singularity-center';
    }
    if (r > rEscape) return 'escape';
    return '';
  };

  /**
   * Advance by dtau of proper time with body thrust `acc` (ship-frame components, M^-1) and body rotation rate `w`
   * (rad / M). Returns the new state and the ending event ('' if none); on numerical failure the last good state.
   * @param {ShipState} s0 @param {number} dtau @param {number[]} [acc] @param {number[]} [w] @param {{maxSteps?: number}} [lim]
   * @returns {{state: ShipState, event: string, steps: number, done: number}} done: the proper time integrated
   */
  function advance(s0, dtau, acc = [0, 0, 0], w = [0, 0, 0], lim = {}) {
    let s = s0;
    let y = pack(s);
    let done = 0, steps = 0;
    const r0 = Math.max(S.rShip(s.X), 1e-3);
    if (!(h > 0)) h = 0.02 * Math.min(r0 ** 1.5, r0);
    let k1 = rhs(y, acc, w);
    const amag = Math.hypot(acc[0], acc[1], acc[2]);
    // the error control watches the event and u; the triad's rotation (attitude rate) is bounded separately
    const wmag = Math.hypot(w[0], w[1], w[2]);
    const hRot = wmag > 0 ? 0.05 / wmag : Infinity;
    while (done < dtau) {
      if (steps >= (lim.maxSteps ?? 100000)) break;
      const hh = Math.min(h, hRot, dtau - done);
      const ks = [k1];
      for (let st = 1; st < 7; st++) {
        const yi = y.map((v, i) => { let acc2 = v; for (let j = 0; j < st; j++) acc2 += hh * A[st][j] * ks[j][i]; return acc2; });
        ks.push(rhs(yi, acc, w));
      }
      const y5 = y.map((v, i) => { let a = v; for (let j = 0; j < 7; j++) a += hh * B5[j] * ks[j][i]; return a; });
      // error on X (relative to the distance from the centre) and u
      const r = Math.max(S.rShip(y.slice(0, 4)), 1e-3);
      let err = 0;
      for (let i = 0; i < 8; i++) {
        let e = 0;
        for (let j = 0; j < 7; j++) e += hh * (B5[j] - B4[j]) * ks[j][i];
        const sc = i < 4 ? tol * (r + Math.abs(y5[i]) * 0) : tol * Math.max(1, Math.abs(y5[i]));
        err = Math.max(err, Math.abs(e) / sc);
      }
      if (!Number.isFinite(err)) err = 1e9;
      if (err > 1 && hh > 1e-12 * r) {
        h = hh * Math.max(0.2, 0.9 * err ** -0.2);
        rejected++;
        continue;
      }
      steps++; stepsTotal++;
      done += hh;
      y = y5;
      k1 = ks[6];   // FSAL
      // a step shortened only to land on the end of the interval does not shrink the natural step size (G8: carried
      // into the next frame, it cost ~10 steps per frame instead of 1-2)
      const hNew = hh * Math.min(5, Math.max(0.2, 0.9 * Math.max(err, 1e-10) ** -0.2));
      h = hh < Math.min(h, hRot) * 0.999 ? Math.max(h, Math.min(hNew, h)) : hNew;
      const ev = event(y.slice(0, 4));
      const cand = { ...s, ...unpack(y), tau: s.tau + hh, dv: s.dv + amag * hh };
      if (ev === 'numerical') return { state: s, event: ev, steps, done: done - hh };
      s = cand;
      if (++sinceOrtho >= 10) { s = orthonormalise(s); y = pack(s); k1 = rhs(y, acc, w); sinceOrtho = 0; }
      if (ev) return { state: s, event: ev, steps, done };
    }
    return { state: s, event: '', steps, done };
  }

  return {
    advance, orthonormalise, event, rhs,
    stats: () => ({ steps: stepsTotal, rejected, h }),
    reset: () => { h = NaN; },
  };
}

/**
 * Diagnostics and conserved quantities of a state (plan 4.4, HUD expert): u.u + 1, triad orthonormality, energy
 * E = -u_t and axial angular momentum L_z = g(phi^, u), phi^ = x d_y - y d_x (both Killing vectors in the ship's
 * coordinates of either spacetime), and for Kerr the Carter constant from the Boyer-Lindquist components.
 * @param {Spacetime} S @param {ShipState} s
 */
export function shipInvariants(S, s) {
  const g = S.gShip(s.X);
  const ip = (/** @type {Vec4} */ a, /** @type {Vec4} */ b) => innerProduct(g, a, b);
  const uu = ip(s.u, s.u) + 1;
  let ortho = 0;
  for (let i = 0; i < 3; i++) {
    ortho = Math.max(ortho, Math.abs(ip(s.u, s.e[i])));
    for (let j = i; j < 3; j++) ortho = Math.max(ortho, Math.abs(ip(s.e[i], s.e[j]) - (i === j ? 1 : 0)));
  }
  const E = -ip([1, 0, 0, 0], s.u);
  const L = ip([0, -s.X[2], s.X[1], 0], s.u);
  let Q = NaN;
  if (S.id === 'kerr') {
    const B = S.toTracer(s.X), uB = S.vecToTracer(s.X, s.u);
    const gB = S.gTracer(B[1], B[2]);
    const pth = gB[2][2] * uB[2], a = S.params.a, c2 = Math.cos(B[2]) ** 2, s2 = Math.sin(B[2]) ** 2;
    Q = pth * pth + c2 * (a * a * (1 - E * E) + L * L / s2);
  }
  return { uu, ortho, E, L, Q };
}

/**
 * The proper acceleration of a static observer at X, in coordinates (a^mu = Gamma^mu_tt (u^t)^2 for u = d_t / sqrt(-g_tt)):
 * what thrust must supply to hover (plan 7.3). Null where d_t is not timelike (the ergoregion).
 * @param {Spacetime} S @param {Vec4} X
 */
export function staticAcceleration(S, X) {
  const { G, g } = christoffel(S.gShip, X, Math.max(S.rShip(X), 1e-3));
  if (!(g[0][0] < 0)) return null;
  const ut = 1 / Math.sqrt(-g[0][0]);
  const u = [ut, 0, 0, 0];
  const a = gammaVW(G, u, u).map((v) => -v);
  return { a, u, norm: Math.sqrt(innerProduct(g, a, a)) };
}

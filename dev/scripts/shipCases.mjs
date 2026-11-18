// G5: the ship-dynamics test cases of plan 4.4 as functions returning numbers; used by the unit tests
// (tests/unit/g5ship.test.js) and the headless harness (scripts/g5Harness.mjs).
import { createSpacetime } from '../../js/physics/spacetime.js';
import { createShipIntegrator, shipInvariants, staticAcceleration } from '../../js/physics/ship.js';
import { christoffel } from '../../js/physics/christoffel.js';
import { observer, baseFrame, zamo } from '../../js/physics/observers.js';
import { boostFrame } from '../../js/camera/generalTetrad.js';
import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';

/** a ship state from a tracer-coordinate frame (u, f, right, up) at tracer event B */
export function shipFromTracer(S, B, F) {
  const X = S.fromTracer(B);
  return { tau: 0, X, u: S.vecToShip(X, F.u), e: [F.f, F.right, F.up].map((v) => S.vecToShip(X, v)), dv: 0 };
}
/** a ship moving with velocity v (ZAMO triad components (f = inward, right = +phi, up = north)) at tracer (r, theta, phi) */
export function shipAt(S, r, th, v = [0, 0, 0], phi = 0) {
  const g = S.gTracer(r, th);
  const F = boostFrame(baseFrame(g, zamo(g).u), v);
  return shipFromTracer(S, [0, r, th, phi], F);
}
const run = (S, s, tau, acc, w, tol, rEscape = 2000) => {
  const I = createShipIntegrator(S, { tol, rEscape });
  let st = s, ev = '', steps = 0;
  const t0 = performance.now();
  const res = I.advance(st, tau, acc, w, { maxSteps: 2e6 });
  st = res.state; ev = res.event; steps = res.steps;
  return { state: st, event: ev, steps, ms: performance.now() - t0, I };
};

/** 1. Christoffels by differences vs Schwarzschild's analytic symbols (BL coordinates) */
export function christoffelCheck() {
  const S = createSpacetime('kerr', { a: 0 });
  const r = 7.3, th = 1.1, M = 1;
  const { G } = christoffel((X) => S.gTracer(X[1], X[2]), [0, r, th, 0], r);
  const want = { '0,0,1': M / (r * (r - 2 * M)), '1,0,0': M * (r - 2 * M) / r ** 3, '1,1,1': -M / (r * (r - 2 * M)), '1,2,2': -(r - 2 * M),
    '1,3,3': -(r - 2 * M) * Math.sin(th) ** 2, '2,1,2': 1 / r, '2,3,3': -Math.sin(th) * Math.cos(th), '3,1,3': 1 / r, '3,2,3': Math.cos(th) / Math.sin(th) };
  let maxRel = 0, maxZero = 0;
  for (let m = 0; m < 4; m++) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    const k = `${m},${Math.min(a, b)},${Math.max(a, b)}`;
    if (k in want) maxRel = Math.max(maxRel, Math.abs(G[m][a][b] - want[k]) / Math.abs(want[k]));
    else maxZero = Math.max(maxZero, Math.abs(G[m][a][b]));
  }
  return { maxRel, maxZero };
}

/** 2. conservation with engines off (Kerr a = 0.9): an inclined, eccentric bound orbit, n orbits */
export function conservationKerr(nOrbits = 3, tol = 1e-10) {
  const S = createSpacetime('kerr', { a: 0.9 });
  const s0 = shipAt(S, 10, Math.PI / 2 - 0.3, [0.05, 0.27, 0.12]);
  const i0 = shipInvariants(S, s0);
  const period = 2 * Math.PI * 9 ** 1.5;   // ~ the radial period scale near the mean radius
  const r = run(S, s0, nOrbits * period, [0, 0, 0], [0, 0, 0], tol);
  const i1 = shipInvariants(S, r.state);
  const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
  return { E0: i0.E, L0: i0.L, Q0: i0.Q, dE: rel(i1.E, i0.E) / nOrbits, dL: rel(i1.L, i0.L) / nOrbits, dQ: rel(i1.Q, i0.Q) / nOrbits,
    uu: Math.abs(i1.uu), ortho: i1.ortho, event: r.event, steps: r.steps, ms: r.ms, perOrbit: nOrbits };
}

/** 3. the same geodesic integrated in Kerr-Schild and in Boyer-Lindquist coordinates */
export function ksVsBl(tau = 300, tol = 1e-11) {
  const S = createSpacetime('kerr', { a: 0.9 });
  const s0 = shipAt(S, 12, 1.0, [0.1, 0.2, -0.1]);
  const ks = run(S, s0, tau, [0, 0, 0], [0, 0, 0], tol);
  // a Boyer-Lindquist "spacetime" for the integrator: the tracer metric as the ship's
  const BL = { ...S, id: 'kerrBL', gShip: (X) => S.gTracer(X[1], X[2]), rShip: (X) => X[1], toTracer: (X) => X, metric: { ...S.metric, singularities: () => [] } };
  const B0 = S.toTracer(s0.X);
  const sB = { tau: 0, X: B0, u: S.vecToTracer(s0.X, s0.u), e: s0.e.map((v) => S.vecToTracer(s0.X, v)), dv: 0 };
  const bl = run(/** @type {any} */ (BL), sB, tau, [0, 0, 0], [0, 0, 0], tol);
  const Bks = S.toTracer(ks.state.X), Bbl = bl.state.X;
  const dphi = ((Bks[3] - Bbl[3]) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return { dr: Math.abs(Bks[1] - Bbl[1]), dth: Math.abs(Bks[2] - Bbl[2]), dphi: Math.abs(dphi), dt: Math.abs(Bks[0] - Bbl[0]), rEnd: Bks[1] };
}

/** 4. a circular orbit stays circular with the analytic period 2 pi (r^1.5 + a) */
export function circularOrbit(r = 10, a = 0.9, tol = 1e-11) {
  const S = createSpacetime('kerr', { a });
  const ob = observer('circularPro', S.gTracer, r, Math.PI / 2);
  const s0 = shipFromTracer(S, [0, r, Math.PI / 2, 0], baseFrame(S.gTracer(r, Math.PI / 2), ob.u));
  const T = 2 * Math.PI * (r ** 1.5 + a);
  const res = run(S, s0, T / ob.u[0], [0, 0, 0], [0, 0, 0], tol);
  const B = S.toTracer(res.state.X);
  // compare against where the analytic orbit is at the same coordinate time
  const Om = 1 / (r ** 1.5 + a);
  const phiWant = Om * (B[0] - S.toTracer(s0.X)[0]);
  const dphi = Math.abs(((B[3] - phiWant) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return { drRel: Math.abs(B[1] - r) / r, dth: Math.abs(B[2] - Math.PI / 2), dphi, tPeriod: B[0] - S.toTracer(s0.X)[0], T };
}

/** 5. ISCO (Schwarzschild, 6 M): a circular orbit just inside plunges, just outside stays */
export function isco(dr = 0.1) {
  const S = createSpacetime('kerr', { a: 0 });
  const out = {};
  for (const [name, r] of [['inside', 6 - dr], ['outside', 6 + dr]]) {
    const ob = observer('circularPro', S.gTracer, r, Math.PI / 2);
    // a tiny inward nudge
    const F = boostFrame(baseFrame(S.gTracer(r, Math.PI / 2), ob.u), [1e-3, 0, 0]);
    const res = run(S, shipFromTracer(S, [0, r, Math.PI / 2, 0], F), 3000, [0, 0, 0], [0, 0, 0], 1e-9);
    out[name] = { event: res.event, rEnd: S.toTracer(res.state.X)[1], tau: res.state.tau };
  }
  return out;
}

/**
 * 6. hovering: the static observer's acceleration (analytic: sqrt(Delta) / (r^3 (1 - 2/r)) on the equator, which for
 * a = 0 is 1 / (r^2 sqrt(1 - 2/r))), and a ship holding it at constant thrust. Hovering is unstable (a perturbation
 * grows on a time of a few M near the hole), so constant thrust holds only briefly; a 100 M hold needs the feedback of
 * the hover autopilot (G6).
 */
export function hover(r = 3, a = 0, th = Math.PI / 2, tau = 10) {
  const S = createSpacetime('kerr', { a });
  const B = [0, r, th, 0];
  const X = S.fromTracer(B);
  const sa = staticAcceleration(S, X);
  const analytic = Math.abs(th - Math.PI / 2) < 1e-12 ? Math.sqrt(r * r - 2 * r + a * a) / (r ** 3 * (1 - 2 / r)) : NaN;
  const g = S.gShip(X);
  // the ship hovering: u = the static observer, triad by Gram-Schmidt of the coordinate directions
  const gT = S.gTracer(r, th);
  const st = observer('static', S.gTracer, r, th);
  const s0 = shipFromTracer(S, B, baseFrame(gT, st.u));
  const acc = s0.e.map((e) => innerProduct(g, sa.a, e));
  const res = run(S, s0, tau, acc, [0, 0, 0], 1e-11);
  return { norm: sa.norm, analytic, rel: Math.abs(sa.norm - analytic) / analytic, drift: Math.abs(S.toTracer(res.state.X)[1] - r), thrust: acc };
}

/** 7. geodetic precession: a non-rotating triad after one circular orbit in Schwarzschild */
export function geodetic(r = 10) {
  const S = createSpacetime('kerr', { a: 0 });
  const th = Math.PI / 2;
  const ob = observer('circularPro', S.gTracer, r, th);
  const F = baseFrame(S.gTracer(r, th), ob.u);
  // e0 = radial outward (-f of the base frame), e1 = along the orbit's phi direction, e2 = up
  const s0 = shipFromTracer(S, [0, r, th, 0], { u: F.u, f: F.f.map((x) => -x), right: F.right, up: F.up });
  const Om = 1 / r ** 1.5, T = 2 * Math.PI / Om;
  const res = run(S, s0, T / ob.u[0], [0, 0, 0], [0, 0, 0], 1e-11);
  const s1 = res.state;
  const B1 = S.toTracer(s1.X);
  const g1 = S.gTracer(B1[1], B1[2]);
  const F1 = baseFrame(g1, S.vecToTracer(s1.X, s1.u));
  const e0 = S.vecToTracer(s1.X, s1.e[0]);
  const rhat = F1.f.map((x) => -x);
  const alpha = Math.atan2(innerProduct(g1, e0, F1.right), innerProduct(g1, e0, rhat));
  const want = 2 * Math.PI * (1 - Math.sqrt(1 - 3 / r));
  // the angle mod 2 pi, either sense
  const err = Math.min(Math.abs(Math.abs(alpha) - want), Math.abs(Math.abs(alpha) - (2 * Math.PI - want)));
  return { alpha, want, err, phiEnd: B1[3] };
}

/** 8. far from the hole: constant proper acceleration gives hyperbolic motion x = (cosh g tau - 1)/g, t = sinh(g tau)/g */
export function hyperbolic(gacc = 1e-3, tau = 1000) {
  const S = createSpacetime('kerr', { a: 0 });
  const r0 = 1e8;
  const s0 = shipAt(S, r0, Math.PI / 2);
  // e[0] = forward = inward (base frame f): thrust along -e0 pushes outward; use +e0 (inward) for the test
  const res = run(S, s0, tau, [gacc, 0, 0], [0, 0, 0], 1e-11, Infinity);
  const B = S.toTracer(res.state.X);
  const x = r0 - B[1], t = B[0] - S.toTracer(s0.X)[0];
  const xw = (Math.cosh(gacc * tau) - 1) / gacc, tw = Math.sinh(gacc * tau) / gacc;
  return { x, xw, t, tw, relX: Math.abs(x - xw) / xw, relT: Math.abs(t - tw) / tw, dv: res.state.dv };
}

/** 9. ST3Cr: E and L_z conserved; a dive into the cap and out again; singularity detection */
export function fuzzball(lambda = 0.005) {
  const S = createSpacetime('st3cr', { lambda });
  // a bound orbit
  const s0 = shipAt(S, 6, Math.PI / 2 - 0.2, [0.02, 0.38, 0.05]);
  const i0 = shipInvariants(S, s0);
  const orb = run(S, s0, 600, [0, 0, 0], [0, 0, 0], 1e-10);
  const i1 = shipInvariants(S, orb.state);
  // a dive: start at 2 M, falling with a tiny sideways speed (misses the sources), comes back out
  const d0 = shipAt(S, 2, 1.2, [0, 0.02, 0]);
  const I = createShipIntegrator(S, { tol: 1e-10 });
  let st = d0, rMin = Infinity, event = '', tauMin = 0, tMin = 0;
  for (let k = 0; k < 4000 && !event; k++) {
    const r = I.advance(st, 0.05, [0, 0, 0], [0, 0, 0], { maxSteps: 1e6 });
    st = r.state; event = r.event;
    const rr = S.rShip(st.X);
    if (rr < rMin) { rMin = rr; tauMin = st.tau; tMin = st.X[0]; }
    if (rr > 1.5 && st.tau > tauMin + 1) break;
  }
  const back = S.rShip(st.X);
  // aimed straight at a D6 centre (on the axis): the flight ends there
  const a0 = shipAt(S, 0.5, 1e-4, [0, 0, 0]);
  const hit = run(S, a0, 50, [0, 0, 0], [0, 0, 0], 1e-10);
  return { dE: Math.abs(i1.E - i0.E) / Math.abs(i0.E), dL: Math.abs(i1.L - i0.L) / Math.abs(i0.L), uu: Math.abs(i1.uu),
    dive: { rMin, back, event, tauIn: tauMin, tIn: tMin, tauOut: st.tau, tOut: st.X[0] }, axisHit: hit.event };
}

/** timing: one game frame's integration (1/60 s at 20 M/s of proper time) near the hole */
export function frameCost() {
  const S = createSpacetime('kerr', { a: 0.9 });
  const I = createShipIntegrator(S, { tol: 1e-10 });
  let s = shipAt(S, 8, 1.3, [0.05, 0.3, 0]);
  const t0 = performance.now();
  let n = 0;
  for (; n < 300; n++) s = I.advance(s, 20 / 60).state;
  return { msPerFrame: (performance.now() - t0) / n, steps: I.stats().steps / n };
}

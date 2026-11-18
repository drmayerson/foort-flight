// G6: the assists reach their targets (plan G6 tests) through the physical-mode step the game uses.
import { describe, it, expect } from 'vitest';
import { createSpacetime } from '../../../js/physics/spacetime.js';
import { createPhysical, physicalStart, shipOn } from '../../../js/game/physicalMode.js';
import { shipInvariants } from '../../../js/physics/ship.js';
import { tidalTensor } from '../../../js/physics/tidal.js';
import { innerProduct } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { observer, baseFrame } from '../../../js/physics/observers.js';

const idle = (actions = []) => ({ move: [0, 0, 0], look: [0, 0], roll: 0, speedFactor: 1, engine: false, actions: new Set(actions) });
/** fly n frames of 1/60 s at `rate` M/s; returns the states */
function fly(P, st, n, rate = 20, first = []) {
  const out = [];
  for (let k = 0; k < n; k++) { st = P.step(st, idle(k === 0 ? first : []), 1 / 60, rate, false); out.push(st); }
  return out;
}

describe('assists', () => {
  it('hover holds r to 1e-3 M over 100 M (Schwarzschild r = 4; Kerr a = 0.9 at r = 6)', () => {
    for (const [a, r] of [[0, 4], [0.9, 6]]) {
      const S = createSpacetime('kerr', { a });
      const P = createPhysical(S);
      // start hovering: the static observer's 4-velocity, the hover assist engaged
      let st = physicalStart(S, /** @type {any} */ (shipOn(S, { r, theta: Math.PI / 2, family: 'static', look: 'out' })));
      st = { ...st, level: 0.5 };
      st = P.engage(st, 'hover');
      // 1/3 M per frame; the per-frame CPU budget may trim a frame's proper time, so fly until 100 M have passed
      const frames = [];
      while (!frames.length || frames.at(-1).ship.tau < 100) { st = P.step(st, idle(), 1 / 60, 20, false); frames.push(st); if (frames.length > 2000) break; }
      const rs = frames.map((f) => S.toTracer(f.ship.X)[1]);
      expect(frames.at(-1).ship.tau).toBeGreaterThan(100);
      expect(Math.max(...rs.map((x) => Math.abs(x - r)))).toBeLessThan(1e-3);
      expect(frames.at(-1).event).toBe('');
    }
  });
  it('hover is refused in the ergoregion with the explanation', () => {
    const S = createSpacetime('kerr', { a: 0.9 });
    const P = createPhysical(S);
    let st = physicalStart(S, /** @type {any} */ (shipOn(S, { r: 1.8, theta: Math.PI / 2, family: 'zamo' })));
    st = P.step(st, idle(['assist6']), 1 / 60, 20, false);
    expect(st.assist).toBeNull();
    expect(st.assistStatus).toMatch(/ergoregion/);
  });
  it('circularize gives an eccentricity below 1e-3', () => {
    const S = createSpacetime('kerr', { a: 0.9 });
    const P = createPhysical(S);
    const r0 = 10, th = Math.PI / 2;
    // start at 10 M with 90% of the circular orbital speed: an eccentric orbit
    const ob = observer('circularPro', S.gTracer, r0, th), g = S.gTracer(r0, th);
    const Z = baseFrame(g, observer('zamo', S.gTracer, r0, th).u);
    const vc = innerProduct(g, ob.u, Z.right) / -innerProduct(g, ob.u, Z.u);
    let ship = /** @type {any} */ (shipOn(S, { r: r0, theta: th, family: 'zamo', look: 'prograde' }));
    // boost along right (prograde) by 0.9 vc
    const v = 0.9 * vc, gam = 1 / Math.sqrt(1 - v * v);
    const zR = Z.right;
    const u = Z.u.map((x, i) => gam * (x + v * zR[i]));
    ship = { ...ship, u: S.vecToShip(ship.X, u) };
    ship.e = ship.e.map((e) => { const k = innerProduct(S.gShip(ship.X), e, ship.u); return e.map((x, i) => x + k * ship.u[i]); });
    let st = { ...physicalStart(S, ship), level: 0.2 };
    st = P.engage(st, 'circularize');
    let n = 0;
    while (st.assist && n < 3000) { st = P.step(st, idle(), 1 / 60, 5, false); n++; }
    expect(st.assist).toBeNull();
    // coast one orbit with the engines off: eccentricity from r_min and r_max
    const rA = S.toTracer(st.ship.X)[1];
    let rmin = Infinity, rmax = 0;
    const T = 2 * Math.PI * (rA ** 1.5 + 0.9);
    const res = P.I.advance(st.ship, 0, [0, 0, 0]);
    let s = res.state;
    for (let k = 0; k < 200; k++) { s = P.I.advance(s, 1.2 * T / 200).state; const rr = S.toTracer(s.X)[1]; rmin = Math.min(rmin, rr); rmax = Math.max(rmax, rr); }
    expect((rmax - rmin) / (rmax + rmin)).toBeLessThan(1e-3);
  });
  it('match ZAMO stops relative motion; pointing prograde turns the nose', () => {
    const S = createSpacetime('kerr', { a: 0.9 });
    const P = createPhysical(S);
    let ship = /** @type {any} */ (shipOn(S, { r: 12, theta: Math.PI / 2, family: 'circularPro', look: 'hole' }));
    let st = { ...physicalStart(S, ship), level: 0.2 };
    st = P.engage(st, 'prograde');
    for (let n = 0; n < 300; n++) st = P.step(st, idle(), 1 / 60, 5, false);
    expect(st.assistStatus).toMatch(/holding/);
    expect(st.assist?.id).toBe('prograde');
    st = P.engage(st, 'matchZamo');
    let n = 0;
    while (st.assist && n < 3000) { st = P.step(st, idle(), 1 / 60, 5, false); n++; }
    expect(st.assist).toBeNull();
    const B = S.toTracer(st.ship.X), gT = S.gTracer(B[1], B[2]);
    const uZ = S.vecToShip(st.ship.X, observer('zamo', S.gTracer, B[1], B[2]).u);
    const gam = -innerProduct(S.gShip(st.ship.X), uZ, st.ship.u);
    // released when matched to 2e-7 c; the frame after release has fallen freely for 1/12 M (about 6e-4 c)
    expect(st.assistStatus).toMatch(/done/);
    expect(gam - 1).toBeLessThan(1e-6);
    expect(gT).toBeTruthy();
  });
  it('tidal tensor: Schwarzschild static observer, eigenvalues -2M/r^3, M/r^3, M/r^3', () => {
    const S = createSpacetime('kerr', { a: 0 });
    for (const r of [4, 10]) {
      const s = /** @type {any} */ (shipOn(S, { r, theta: 1.0, family: 'static' }));
      const T = tidalTensor(S.gShip, s.X, s.u, s.e, r);
      expect(T.eigen[0] / (-2 / r ** 3)).toBeCloseTo(1, 4);
      expect(T.eigen[1] / (1 / r ** 3)).toBeCloseTo(1, 4);
      expect(T.eigen[2] / (1 / r ** 3)).toBeCloseTo(1, 4);
    }
  });
  it('engines off is free fall: E and L_z constant through the physical step; warp works', () => {
    const S = createSpacetime('kerr', { a: 0.9 });
    const P = createPhysical(S);
    let st = physicalStart(S, /** @type {any} */ (shipOn(S, { r: 10, theta: Math.PI / 2, family: 'circularPro', look: 'prograde' })));
    const i0 = shipInvariants(S, st.ship);
    for (let k = 0; k < 3; k++) st = P.step(st, idle(['warpUp']), 1 / 60, 20, false);
    expect(st.lastWarp).toBe(10);
    for (let k = 0; k < 100; k++) st = P.step(st, idle(), 1 / 60, 20, false);
    const i1 = shipInvariants(S, st.ship);
    expect(Math.abs(i1.E - i0.E)).toBeLessThan(1e-9);
    expect(Math.abs(i1.L - i0.L)).toBeLessThan(1e-8);
  });
});

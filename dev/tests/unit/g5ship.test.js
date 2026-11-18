// G5: ship dynamics against the plan's tests (4.4); the cases are in scripts/shipCases.mjs (also run by g5Harness.mjs).
import { describe, it, expect } from 'vitest';
import * as C from '../../scripts/shipCases.mjs';
import { createSpacetime } from '../../../js/physics/spacetime.js';
import { createShipIntegrator } from '../../../js/physics/ship.js';
import { innerProduct } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';

describe('ship dynamics (plan 4.4)', () => {
  it('Christoffels by differences = Schwarzschild analytic', () => {
    const r = C.christoffelCheck();
    expect(r.maxRel).toBeLessThan(1e-9);
    expect(r.maxZero).toBeLessThan(1e-10);
  });
  it('engines off in Kerr: E, L_z, Carter Q and u.u conserved to <= 1e-8 per orbit', () => {
    const r = C.conservationKerr(3);
    expect(r.event).toBe('');
    expect(r.dE).toBeLessThan(1e-8); expect(r.dL).toBeLessThan(1e-8); expect(r.dQ).toBeLessThan(1e-8);
    expect(r.uu).toBeLessThan(1e-10); expect(r.ortho).toBeLessThan(1e-10);
  });
  it('the same geodesic in Kerr-Schild and in Boyer-Lindquist coordinates', () => {
    const r = C.ksVsBl();
    expect(r.dr).toBeLessThan(1e-6); expect(r.dth).toBeLessThan(1e-6); expect(r.dphi).toBeLessThan(1e-6);
  });
  it('a circular orbit at 10 M stays circular with the analytic period', () => {
    const r = C.circularOrbit();
    expect(r.drRel).toBeLessThan(1e-9); expect(r.dphi).toBeLessThan(1e-8);
    expect(Math.abs(r.tPeriod - r.T) / r.T).toBeLessThan(1e-9);
  });
  it('ISCO: an orbit just inside plunges, just outside stays', () => {
    const r = C.isco();
    expect(r.inside.event).toBe('horizon');
    expect(r.outside.event).toBe('');
    expect(r.outside.rEnd).toBeGreaterThan(5.5); expect(r.outside.rEnd).toBeLessThan(6.6);
  });
  it('hovering thrust = the static observer acceleration (Schwarzschild, Kerr outside the ergoregion)', () => {
    const s = C.hover(3, 0), k = C.hover(4, 0.9);
    expect(s.rel).toBeLessThan(1e-9); expect(k.rel).toBeLessThan(1e-9);
    expect(s.drift).toBeLessThan(1e-8);   // constant thrust holds briefly (hovering is unstable)
  });
  it('geodetic precession of a non-rotating triad: 2 pi [1 - sqrt(1 - 3M/r)] per orbit', () => {
    expect(C.geodetic(10).err).toBeLessThan(1e-8);
  });
  it('flat limit: constant proper acceleration is hyperbolic motion', () => {
    const r = C.hyperbolic();
    expect(r.relX).toBeLessThan(1e-6); expect(r.relT).toBeLessThan(1e-6);
    expect(r.dv).toBeCloseTo(1, 9);
  });
  it('ST3Cr: E, L_z conserved; a dive into the cap and back; a D6 centre ends the flight', () => {
    const r = C.fuzzball();
    expect(r.dE).toBeLessThan(1e-8); expect(r.dL).toBeLessThan(1e-8);
    expect(r.dive.event).toBe(''); expect(r.dive.rMin).toBeLessThan(0.02); expect(r.dive.back).toBeGreaterThan(1.4);
    expect(r.dive.tIn / r.dive.tauIn).toBeGreaterThan(3);   // the outside clock runs fast on the way down the throat
    expect(r.axisHit).toBe('singularity-center');
  });
  it('attitude rate: w along up turns the forward axis towards right at |w| rad per M', () => {
    const S = createSpacetime('kerr', { a: 0 });
    const s0 = C.shipAt(S, 1e7, Math.PI / 2);
    const I = createShipIntegrator(S, { tol: 1e-11, rEscape: Infinity });
    const s1 = I.advance(s0, 5, [0, 0, 0], [0, 0, 0.1]).state;
    const g = S.gShip(s1.X);
    const ang = Math.atan2(innerProduct(g, s1.e[0], s0.e[1]), innerProduct(g, s1.e[0], s0.e[0]));
    expect(ang).toBeCloseTo(0.5, 6);
  });
  it('one game frame of integration costs well under 2 ms', () => {
    expect(C.frameCost().msPerFrame).toBeLessThan(2);
  });
});

import { advanceFrame, massRatio } from '../../../js/game/shipClock.js';
describe('ship clock', () => {
  it('time warp multiplies the proper time per frame, not while thrusting; the CPU budget caps it', () => {
    const S = createSpacetime('kerr', { a: 0.9 });
    const I = createShipIntegrator(S, { tol: 1e-10 });
    const s0 = C.shipAt(S, 12, 1.3, [0, 0.28, 0]);
    const a = advanceFrame(I, s0, { dtWall: 1 / 60, rate: 20, warp: 10, acc: [0, 0, 0], w: [0, 0, 0] });
    expect(a.dtau).toBeCloseTo(20 / 60 * 10, 9);
    const b = advanceFrame(I, a.state, { dtWall: 1 / 60, rate: 20, warp: 10, acc: [0.01, 0, 0], w: [0, 0, 0] });
    expect(b.warp).toBe(1);
    expect(b.dtau).toBeCloseTo(20 / 60, 9);
    const c = advanceFrame(I, b.state, { dtWall: 1, rate: 20, warp: 100, acc: [0, 0, 0], w: [0, 0, 0], budgetMs: 0.01 });
    expect(c.limited).toBe(true);
    expect(c.warp).toBeLessThan(100);
  });
  it('relativistic rocket: a photon rocket for delta-v = 1 needs a mass ratio of e', () => {
    expect(massRatio(1)).toBeCloseTo(Math.E, 12);
  });
});

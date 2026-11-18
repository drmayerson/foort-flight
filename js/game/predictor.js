// @ts-check
// Trajectory prediction for the map (plan 6): the ship's path with the engines off, integrated ahead on the CPU in
// small slices each frame (a time budget, so the frame rate is untouched), restarted from the current state a few times
// per second, for about three orbits at the current radius or until an ending event. Also the trail of the past path.

import { createShipIntegrator } from '../physics/ship.js';

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime @typedef {import('../physics/ship.js').ShipState} ShipState */

/** points per integration step on the drawn path */
const HERMITE = 8;

export class Predictor {
  /** @param {Spacetime} S */
  constructor(S) {
    this.S = S;
    this.I = createShipIntegrator(S, { tol: 1e-8 });
    /** @type {number[][]} */ this.points = [];
    /** @type {number[][]} */ this.next = [];
    /** @type {ShipState|null} */ this.cur = null;
    this.horizonTau = 0; this.event = ''; this.nextEvent = ''; this.started = 0;
    /** @type {number[][]} */ this.trail = [];
  }

  /** start a new prediction from a state @param {ShipState} s */
  restart(s) {
    const r = Math.max(this.S.rShip(s.X), 1e-3);
    this.cur = s;
    this.horizonTau = Math.min(Math.max(3 * 2 * Math.PI * r ** 1.5, 30), 4000);
    this.next = [[s.X[1], s.X[2], s.X[3]]];
    this.nextEvent = '';
    this.started = s.tau;
    this.I.reset();
  }

  /** do some work @param {number} budgetMs */
  work(budgetMs) {
    if (!this.cur) return;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs && this.cur) {
      // one adaptive step per call, towards the end of the horizon, so the time budget is kept to a step (2026-11-18:
      // slices of 1/2000 of the horizon capped the step size; a prediction then took ~360 frames and, restarted every
      // 300 ms, never finished: the map showed no predicted path)
      const left = this.horizonTau - (this.cur.tau - this.started);
      const a = this.cur;
      const res = this.I.advance(a, left, [0, 0, 0], [0, 0, 0], { maxSteps: 1 });
      const b = res.state;
      // the steps are long (~20 per orbit): cubic Hermite points in between (dX/dtau = u) for a smooth curve
      const h = b.tau - a.tau;
      for (let k = 1; k <= HERMITE; k++) {
        const t = k / HERMITE, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = 1 - h00, h11 = t ** 3 - t * t;
        this.next.push([1, 2, 3].map((i) => h00 * a.X[i] + h10 * h * a.u[i] + h01 * b.X[i] + h11 * h * b.u[i]));
      }
      this.cur = b;
      if (res.event || res.done === 0 || res.state.tau - this.started >= this.horizonTau * (1 - 1e-9)) {
        this.points = this.next; this.event = res.event; this.cur = null;
      }
    }
  }

  /** the ship's own position, for the trail @param {ShipState} s */
  record(s) {
    const p = [s.X[1], s.X[2], s.X[3]];
    const last = this.trail.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.01 * Math.max(this.S.rShip(s.X), 0.01)) this.trail.push(p);
    if (this.trail.length > 2000) this.trail.shift();
  }
}

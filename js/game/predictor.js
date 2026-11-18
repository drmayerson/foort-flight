// @ts-check
// Trajectory prediction for the map (plan 6): the ship's path with the engines off, integrated ahead on the CPU in
// small slices each frame (a time budget, so the frame rate is untouched), restarted from the current state a few times
// per second, for about three orbits at the current radius or until an ending event. Also the trail of the past path.

import { createShipIntegrator } from '../physics/ship.js';

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime @typedef {import('../physics/ship.js').ShipState} ShipState */

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
      // small slices (about one step each), so the time budget is kept to a step (G8: 1/300 of the horizon overshot it)
      const res = this.I.advance(this.cur, this.horizonTau / 2000, [0, 0, 0], [0, 0, 0], { maxSteps: 4 });
      this.cur = res.state;
      if ((this.n = (this.n ?? 0) + 1) % 4 === 0) this.next.push([res.state.X[1], res.state.X[2], res.state.X[3]]);
      if (res.event || res.state.tau - this.started >= this.horizonTau) {
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

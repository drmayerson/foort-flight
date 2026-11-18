// @ts-check
// Physical mode (plan 2, 7.1-7.3; G6): the camera is a spaceship on a timelike worldline (js/physics/ship.js). Engines
// off = free fall (a geodesic); W/S, A/D, R/F fire the translation thrusters (20% of the thrust level) along the ship's
// axes; Shift fires the main engine (forward, the full level). The mouse turns the ship (reaction wheels; an exact
// rotation of its frame). Assists (js/game/assists.js) steer or thrust within the same limits, and the HUD names them.
// Mode switches: physical -> free keeps the event and attitude; free -> physical starts with the free camera's observer
// (a ZAMO starts falling), or in a circular orbit, or hovering (with the hover assist engaged).

import { createShipIntegrator } from '../physics/ship.js';
import { advanceFrame, WARPS } from './shipClock.js';
import { assistStep, rotateTriad, ASSISTS } from './assists.js';
import { freeFrame } from './freeMode.js';
import { observer, baseFrame } from '../physics/observers.js';
import { boostFrame } from '../camera/generalTetrad.js';

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime @typedef {import('../physics/ship.js').ShipState} ShipState */

/**
 * @typedef {Object} PhysicalState
 * @property {ShipState} ship
 * @property {number} level       thrust level: proper acceleration of the main engine (c^4/GM, i.e. 1/M)
 * @property {number} warpIdx
 * @property {{id: string, target?: number[]}|null} assist
 * @property {string} assistStatus
 * @property {string} event       the ending event ('' while flying)
 * @property {number[]} lastAcc   body thrust of the last frame
 * @property {number} lastWarp
 */

/** @param {Spacetime} S @param {ShipState} ship @returns {PhysicalState} */
export const physicalStart = (S, ship) => ({ ship, level: 0.05, warpIdx: 0, assist: null, assistStatus: '', event: '', lastAcc: [0, 0, 0], lastWarp: 1 });

/**
 * A ship state from the free camera (its observer's 4-velocity and its view frame).
 * @param {Spacetime} S @param {import('./freeMode.js').FreeState} free @param {'observer'|'circular'|'hover'} how
 * @returns {{ship: ShipState, note: string, hover: boolean}}
 */
export function shipFromFree(S, free, how = 'observer') {
  let family = free.family, note = '';
  if (how === 'circular') family = 'circularPro';
  if (how === 'hover') family = 'static';
  const fr = freeFrame(S, { ...free, family });
  if (fr.note) note = fr.note;
  const F = fr.F;
  return { ship: { tau: free.tau, X: free.X, u: F.u, e: [F.f, F.right, F.up], dv: 0 }, note, hover: how === 'hover' && !fr.note };
}

/** the free camera's attitude from a ship (Cartesian directions of its forward and up legs) @param {ShipState} s */
export function freeAttitudeFromShip(s) {
  const n = (/** @type {number[]} */ v) => { const k = Math.hypot(v[1], v[2], v[3]); return [v[1] / k, v[2] / k, v[3] / k]; };
  return { fwd: n(s.e[0]), up: n(s.e[2]) };
}

/**
 * @param {Spacetime} S
 */
export function createPhysical(S) {
  const I = createShipIntegrator(S, { tol: 1e-10 });
  return {
    I,
    /**
     * One frame.
     * @param {PhysicalState} st
     * @param {import('./controls.js').FrameInput} input
     * @param {number} dtWall seconds @param {number} rate M of proper time per second @param {boolean} paused
     * @returns {PhysicalState}
     */
    step(st, input, dtWall, rate, paused) {
      if (st.event) return st;
      let ship = st.ship;
      let level = Math.min(Math.max(st.level * input.speedFactor, 1e-4), 2);
      let warpIdx = st.warpIdx;
      if (input.actions.has('warpUp')) warpIdx = Math.min(WARPS.length - 1, warpIdx + 1);
      if (input.actions.has('warpDown')) warpIdx = Math.max(0, warpIdx - 1);
      let assist = st.assist;
      for (const a of input.actions) {
        const m = /^assist(\d)$/.exec(a);
        if (!m) continue;
        const id = /** @type {Record<string, string>} */ ({ 1: 'kill', 2: 'prograde', 3: 'retrograde', 4: 'radialIn', 5: 'radialOut', 6: 'hover', 7: 'circularize', 8: 'matchZamo' })[m[1]];
        if (!id) continue;
        assist = assist?.id === id ? null : { id, target: id === 'hover' ? S.toTracer(ship.X) : undefined };
      }
      // the player's turn (reaction wheels): yaw about up, pitch about right, roll about forward
      const turn = [input.roll, -input.look[1], input.look[0]];
      if (turn.some((x) => x !== 0)) ship = rotateTriad(ship, [turn[0], 0, 0].map((_, i) => turn[i]));
      // manual thrust
      const manual = [0.2 * level * input.move[0], 0.2 * level * input.move[1], 0.2 * level * input.move[2]];
      if (input.engine) manual[0] += level;
      const manualOn = manual.some((x) => x !== 0);
      let acc = manual;
      let status = '';
      if (assist && !paused) {
        const out = assistStep(assist.id, S, ship, { maxThrust: level, maxTurn: 1.5 * dtWall, target: assist.target });
        if (out.error) { status = out.error; assist = null; }
        else {
          status = out.status;
          if (out.rot) ship = rotateTriad(ship, out.rot);
          if (!manualOn) acc = out.acc;
          if (out.done && assist.id !== 'hover') { status = `${ASSISTS[assist.id]}: done`; assist = null; }
        }
      }
      if (paused) return { ...st, ship, level, warpIdx, assist, assistStatus: status || st.assistStatus };
      const r = advanceFrame(I, ship, { dtWall, rate, warp: WARPS[warpIdx], acc, w: [0, 0, 0] });
      return { ship: r.state, level, warpIdx, assist, assistStatus: status, event: r.event, lastAcc: acc, lastWarp: r.warp };
    },
    /** engage an assist from outside (scenarios, "start hovering here") @param {PhysicalState} st @param {string} id */
    engage(st, id) { return { ...st, assist: { id, target: id === 'hover' ? S.toTracer(st.ship.X) : undefined } }; },
  };
}

/**
 * A ship on a given observer family at tracer (r, theta, phi), looking along a named direction.
 * v: a velocity relative to that observer, in its base triad (towards the hole, +phi, north).
 * @param {Spacetime} S @param {{r: number, theta: number, phi?: number, family: string, v?: number[], look?: 'hole'|'out'|'prograde'|'retrograde'|'north'}} o
 * @returns {ShipState|null}
 */
export function shipOn(S, o) {
  const ob = observer(/** @type {any} */ (o.family), S.gTracer, o.r, o.theta);
  if (!ob.u) return null;
  const g = S.gTracer(o.r, o.theta);
  let B = baseFrame(g, ob.u);   // f = towards the hole, right = +phi, up = north
  if (o.v && o.v.some((x) => x !== 0)) B = boostFrame(B, o.v);
  /** @type {Record<string, number[][]>} f, right, up as combinations of (B.f, B.right, B.up) */
  const looks = {
    hole: [B.f, B.right, B.up], out: [B.f.map((x) => -x), B.right.map((x) => -x), B.up],
    prograde: [B.right, B.f.map((x) => -x), B.up], retrograde: [B.right.map((x) => -x), B.f, B.up], north: [B.up, B.right, B.f.map((x) => -x)],
  };
  const [f, right, up] = looks[o.look ?? 'hole'];
  const X = S.fromTracer([0, o.r, o.theta, o.phi ?? 0]);
  return { tau: 0, X, u: S.vecToShip(X, B.u), e: [f, right, up].map((v) => S.vecToShip(X, v)), dv: 0 };
}

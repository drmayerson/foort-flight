// @ts-check
// Game time for the ship (plan 4.4, F8): proper time advances by (wall dt) x (time rate) x (warp). Warp steps 1-100x;
// disabled while thrusting; and capped by the integrator: each frame gets a CPU budget, and what it cannot integrate
// in that budget is dropped (the clock slows down instead of the frame rate), with the effective warp reported.
// Optional delta-v budget (F10, off by default): the proper acceleration integrated over proper time, and the mass ratio
// of a rocket with exhaust speed v_e (relativistic rocket equation: m0 / m1 = exp(dv / v_e), c = 1).

export const WARPS = [1, 2, 5, 10, 20, 50, 100];

/**
 * Advance a ship by one frame.
 * @param {ReturnType<typeof import('../physics/ship.js').createShipIntegrator>} I
 * @param {import('../physics/ship.js').ShipState} s
 * @param {{dtWall: number, rate: number, warp: number, acc: number[], w: number[], budgetMs?: number}} o
 * @returns {{state: import('../physics/ship.js').ShipState, event: string, dtau: number, warp: number, limited: boolean}}
 */
export function advanceFrame(I, s, o) {
  const thrusting = o.acc.some((x) => x !== 0);
  const warp = thrusting ? 1 : o.warp;
  const want = o.dtWall * o.rate * warp;
  const budget = o.budgetMs ?? 2;
  const t0 = performance.now();
  let st = s, done = 0, event = '';
  // in slices, so the budget can stop it
  const slice = Math.max(want / 8, 1e-6);
  while (done < want - 1e-15) {
    const r = I.advance(st, Math.min(slice, want - done), o.acc, o.w, { maxSteps: 2000 });
    done += r.state.tau - st.tau;
    st = r.state;
    if (r.event) { event = r.event; break; }
    if (performance.now() - t0 > budget) break;
  }
  const limited = !event && done < want * 0.999;
  return { state: st, event, dtau: done, warp: limited ? Math.max(1, warp * done / Math.max(want, 1e-30)) : warp, limited };
}

/** mass ratio m0 / m1 for a delta-v at exhaust speed v_e (photon rocket: v_e = 1) @param {number} dv @param {number} [ve] */
export const massRatio = (dv, ve = 1) => Math.exp(dv / ve);

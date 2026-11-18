// @ts-check
// Scenarios (plan 7.6): sandbox presets in a JSON format that can later carry mission goals.
//   { id, title, spacetime: {id, params}, mode: 'physical'|'free',
//     ship (physical): {r, theta (deg), phi?, family, v? (relative velocity in the family's base triad: towards the hole,
//                       +phi, north), look},
//     camera (free): {r, theta (deg), family},
//     level? (thrust level, 1/M), assist? (engaged at the start), notes, goals? (Stage 2B) }
// Files: scenarios/<id>.json, listed in scenarios/index.json.

import { createSpacetime } from '../physics/spacetime.js';
import { shipOn } from './physicalMode.js';
import { freeStart } from './freeMode.js';

const DEG = Math.PI / 180;
const BASE = new URL('../../scenarios/', import.meta.url).href;

/** @returns {Promise<any[]>} */
export async function loadScenarios() {
  const ids = await (await fetch(new URL('index.json', BASE))).json();
  return Promise.all(ids.map(async (/** @type {string} */ id) => (await fetch(new URL(`${id}.json`, BASE))).json()));
}

/**
 * Build a scenario's spacetime and start state.
 * @param {any} sc
 */
export function buildScenario(sc) {
  const S = createSpacetime(sc.spacetime.id, sc.spacetime.params ?? {});
  if (sc.mode === 'physical') {
    const sp = sc.ship;
    const ship = shipOn(S, { r: sp.r, theta: sp.theta * DEG, phi: (sp.phi ?? 0) * DEG, family: sp.family, v: sp.v, look: sp.look });
    if (!ship) throw new Error(`scenario ${sc.id}: no ${sp.family} observer at r = ${sp.r}`);
    return { S, mode: 'physical', ship, level: sc.level ?? 0.05, assist: sc.assist ?? null };
  }
  const c = sc.camera;
  return { S, mode: 'free', free: freeStart(S, { r: c.r, theta: c.theta * DEG, phi: (c.phi ?? 0) * DEG, family: c.family }) };
}

// @ts-check
// Display defaults shared by the pages (DECISIONS G2).

/** FOORT-GPU's B3 comparison disc: Johnson-SU in the circumferential radius, the same for Kerr and the fuzzball */
export const EMISSION = { mu: 3, gamma: -1.5, sigma: 1, p: 3, fudge: 1, maxPasses: 0, circumferential: true };
/** the trace boundary: far enough that escape directions are close to those at infinity, for the sky (M) */
export const R_BOUNDARY = 100;

import { tierSettings } from '../../vendor/foort-gpu/js/gpu/tiers.js';

/**
 * The game's tracing settings of a quality tier: FOORT-GPU's tiers without its error-controlled integrator (BS3).
 * FOORT-GPU calibrated BS3 (Normal, black holes) for a far camera with a narrow field (r = 1000 M, under 1 degree);
 * near the hole with a 60-90 degree field its escape directions differ from RK4's by about a screen pixel (G3
 * comparison, DECISIONS), for a 1.19x speed-up. So the game's Normal = FOORT-GPU's High.
 * @param {'reference'|'high'|'normal'} tier @param {'BH'|'fuzzball'} mode
 */
export function gameTier(tier, mode) {
  return { ...tierSettings(tier, mode), bs3: null };
}

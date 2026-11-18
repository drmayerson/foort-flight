// @ts-check
// Physical units (plan 4.1, 7.4, G7; F7): the vendored presets (Sgr A*, M87*, a 10 solar-mass hole) or none (units of
// M). With none, g-loads and tidal accelerations are still given for Sgr A* (F7).
// 1 M of time = GM/c^3 = 4.925 us per solar mass; of length GM/c^2 = 1.477 km per solar mass; of acceleration
// c^4/(GM) = c^2 / (GM/c^2).

import { unitsOf, formatDuration, formatLength, UNIT_PRESETS } from '../../vendor/foort-gpu/js/units.js';

export const UNIT_OPTIONS = /** @type {[string, string][]} */ ([['M', 'units of M (G = c = 1)'], ['sgra', 'Sgr A* (4.3 million M☉)'], ['m87', 'M87* (6.5 billion M☉)'], ['stellar', 'a 10 M☉ black hole']]);
const C = 2.99792458e8, G0 = 9.80665;

/** @param {string} preset */
export function gameUnits(preset) {
  const u = preset === 'M' ? null : unitsOf(preset);
  const ref = u ?? /** @type {NonNullable<ReturnType<typeof unitsOf>>} */ (unitsOf('sgra'));
  const label = u ? /** @type {any} */ (UNIT_PRESETS)[preset].label.split(' (')[0] : 'Sgr A*';
  return {
    physical: !!u,
    label,
    /** a time in M (and physical, if units are set) @param {number} m */
    time: (m) => (u ? `${m.toFixed(1)} M = ${formatDuration(m * u.tS)}` : `${m.toFixed(1)} M`),
    /** a length @param {number} m */
    length: (m) => (u ? `${m < 1 ? m.toFixed(4) : m.toFixed(2)} M = ${formatLength(m * u.lKm)}` : `${m < 1 ? m.toFixed(4) : m.toFixed(2)} M`),
    /** an acceleration (1/M) in g, for the chosen mass or Sgr A* @param {number} a */
    g: (a) => a * C * C / (ref.lKm * 1000) / G0,
    /** km per M (for the map's scale bar) */
    kmPerM: u ? u.lKm : null,
    /** metres per M of the reference mass (tidal accelerations over a ship's length) */
    metersPerM: ref.lKm * 1000,
    /** the time rate in words @param {number} rate M per second */
    rate: (rate) => (u ? `${rate} M/s: ${formatDuration(rate * u.tS)} per second` : `${rate} M/s`),
  };
}
/** @typedef {ReturnType<typeof gameUnits>} GameUnits */

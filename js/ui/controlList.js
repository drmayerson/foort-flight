// @ts-check
// The game's settings (plan 7.5): one list; the normal and expert panels are generated from it (js/ui/panels.js), and
// persistence and the URL read and write the same ids (js/ui/persistence.js).
//   apply: 'scene'  a new spacetime (the flight restarts from a start position, the cubemaps are dropped)
//          'render' renderer settings (a new cubemap may follow)
//          'free'   the free camera (observer family, speed)
//          'view'   display only

/**
 * @typedef {Object} Control
 * @property {string} id
 * @property {string} label
 * @property {'normal'|'expert'} group
 * @property {string} section
 * @property {'select'|'range'|'checkbox'} type
 * @property {[string|number, string][]} [options]
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {boolean} [log]  range on a log scale (lambda)
 * @property {string|number|boolean} def
 * @property {'scene'|'render'|'free'|'view'} apply
 * @property {(s: Record<string, any>) => boolean} [visible]
 * @property {string} [help]
 * @property {(v: any) => string} [fmt]
 */

/** @type {Control[]} */
export const CONTROLS = [
  { id: 'spacetime', label: 'Object', group: 'normal', section: 'Spacetime', type: 'select', def: 'kerr', apply: 'scene',
    options: [['kerr', 'black hole (Kerr)'], ['st3cr', 'fuzzball (ST3Cr ring)'], ['st3crBH', 'fuzzball λ = 0 (black hole)']] },
  { id: 'a', label: 'spin a', group: 'normal', section: 'Spacetime', type: 'range', min: 0, max: 0.99, step: 0.01, def: 0.9, apply: 'scene',
    visible: (s) => s.spacetime === 'kerr', fmt: (v) => Number(v).toFixed(2) },
  { id: 'lambda', label: 'λ (cap size)', group: 'normal', section: 'Spacetime', type: 'range', min: 1e-3, max: 0.1, log: true, def: 0.005, apply: 'scene',
    visible: (s) => s.spacetime === 'st3cr', fmt: (v) => Number(v).toPrecision(2) },
  { id: 'mode', label: 'Mode', group: 'normal', section: 'Flight', type: 'select', def: 'free', apply: 'free',
    options: [['free', 'free camera']], help: 'free: move anywhere, no inertia. Physical flight (a spaceship on a worldline) comes in a later milestone.' },
  { id: 'family', label: 'Camera rides with', group: 'normal', section: 'Flight', type: 'select', def: 'zamo', apply: 'free',
    options: [['zamo', 'a ZAMO (zero angular momentum)'], ['static', 'a static (hovering) observer'], ['circularPro', 'a circular orbit, prograde'], ['circularRetro', 'a circular orbit, retrograde']],
    help: 'the local observer whose view you see: its motion sets the Doppler shift and aberration' },
  { id: 'timeRate', label: 'Time rate (M/s)', group: 'normal', section: 'Flight', type: 'range', min: 0, max: 100, step: 1, def: 20, apply: 'view', fmt: (v) => `${v}` },
  { id: 'color', label: 'Colours', group: 'normal', section: 'View', type: 'select', def: 1, apply: 'render', options: [[1, 'blackbody (true colours)'], [0, 'FOORT colour map']] },
  { id: 'sky', label: 'Sky', group: 'normal', section: 'View', type: 'select', def: 1, apply: 'render', options: [[1, 'stars'], [2, 'a picture'], [0, 'none']] },
  { id: 'faceN', label: 'Quality', group: 'normal', section: 'View', type: 'select', def: 256, apply: 'render',
    options: [[128, 'low (faster refresh)'], [256, 'medium'], [384, 'high']] },
  // expert
  { id: 'fov', label: 'Field of view (°)', group: 'expert', section: 'Camera', type: 'range', min: 30, max: 120, step: 1, def: 75, apply: 'render' },
  { id: 'tier', label: 'Integrator tier', group: 'expert', section: 'Tracing', type: 'select', def: 'normal', apply: 'render',
    options: [['normal', 'Normal (RK4, larger far steps)'], ['high', 'High (= Normal in the game)'], ['reference', 'Reference (no far steps; fuzzball 10000 steps)']] },
  { id: 'sigmaN', label: 'Turbulence σ', group: 'expert', section: 'Disc', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.6, apply: 'render' },
  { id: 'T0', label: 'Disc temperature T₀ at 6 M (K)', group: 'expert', section: 'Disc', type: 'range', min: 1500, max: 20000, step: 100, def: 4500, apply: 'render' },
  { id: 'mu', label: 'Johnson-SU μ (M)', group: 'expert', section: 'Disc', type: 'range', min: 0, max: 20, step: 0.1, def: 3, apply: 'render' },
  { id: 'gamma', label: 'Johnson-SU γ', group: 'expert', section: 'Disc', type: 'range', min: -4, max: 2, step: 0.1, def: -1.5, apply: 'render' },
  { id: 'sigma', label: 'Johnson-SU σ (M)', group: 'expert', section: 'Disc', type: 'range', min: 0.1, max: 5, step: 0.05, def: 1, apply: 'render' },
  { id: 'exposure', label: 'Exposure', group: 'expert', section: 'View', type: 'range', min: 0.1, max: 8, step: 0.05, log: true, def: 1, apply: 'render' },
  { id: 'starBrightness', label: 'Star brightness', group: 'expert', section: 'View', type: 'range', min: 0, max: 4, step: 0.1, def: 1, apply: 'render' },
  { id: 'picture', label: 'Picture', group: 'expert', section: 'View', type: 'select', def: 'deep-field', apply: 'render',
    options: [['deep-field', 'Hubble Ultra Deep Field'], ['pillars', 'Pillars of Creation'], ['earth', 'Earth (Apollo 17)'], ['moon', 'Moon (Apollo 11)'], ['earthrise', 'Earthrise (Apollo 8)']],
    visible: (s) => Number(s.sky) === 2 },
  { id: 'inset', label: 'Show the cubemap being traced', group: 'expert', section: 'Debug', type: 'checkbox', def: false, apply: 'render' },
];

/** the default settings @returns {Record<string, any>} */
export const defaultSettings = () => Object.fromEntries(CONTROLS.map((c) => [c.id, c.def]));

/** coerce a value to a control's type @param {Control} c @param {any} v */
export function coerce(c, v) {
  if (c.type === 'checkbox') return v === true || v === 'true' || v === '1' || v === 1;
  if (c.type === 'range') { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, /** @type {number} */ (c.min)), /** @type {number} */ (c.max)) : c.def; }
  const opts = (c.options ?? []).map((o) => o[0]);
  const hit = opts.find((o) => String(o) === String(v));
  return hit ?? c.def;
}

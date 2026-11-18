// @ts-check
// Persistence (plan 7.5): the settings and the last camera state in localStorage (wrapped: storage may be missing or
// refused), and a shareable URL with both. Precedence: defaults < localStorage < URL.

import { CONTROLS, coerce, defaultSettings } from './controlList.js';

const KEY = 'foort-flight:v1';

/** @returns {{settings: Record<string, any>, camera: any}} */
export function loadState() {
  const settings = defaultSettings();
  let camera = null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved?.settings) for (const c of CONTROLS) if (c.id in saved.settings) settings[c.id] = coerce(c, saved.settings[c.id]);
    if (saved?.settings?.__expert) settings.__expert = true;
    if (saved?.camera) camera = saved.camera;
  } catch { /* no storage */ }
  const q = new URLSearchParams(location.search);
  for (const c of CONTROLS) if (q.has(c.id)) settings[c.id] = coerce(c, q.get(c.id));
  if (q.has('expert')) settings.__expert = q.get('expert') === '1';
  const cam = q.get('cam');
  if (cam) {
    // cam = x,y,z,fx,fy,fz,ux,uy,uz (ship coordinates and Cartesian attitude)
    const v = cam.split(',').map(Number);
    if (v.length === 9 && v.every(Number.isFinite)) camera = { spacetime: settings.spacetime, X: [0, v[0], v[1], v[2]], fwd: v.slice(3, 6), up: v.slice(6, 9) };
  }
  return { settings, camera };
}

/** @param {Record<string, any>} settings @param {any} camera */
export function saveState(settings, camera) {
  try { localStorage.setItem(KEY, JSON.stringify({ settings, camera })); } catch { /* no storage */ }
}

/** forget everything saved */
export function clearState() { try { localStorage.removeItem(KEY); } catch { /* no storage */ } }

/** a link that reproduces the settings (those differing from the defaults) and the camera @param {Record<string, any>} settings @param {any} camera */
export function shareUrl(settings, camera) {
  const d = defaultSettings();
  const q = new URLSearchParams();
  for (const c of CONTROLS) if (String(settings[c.id]) !== String(d[c.id])) q.set(c.id, String(settings[c.id]));
  if (camera) q.set('cam', [...camera.X.slice(1), ...camera.fwd, ...camera.up].map((x) => +Number(x).toPrecision(6)).join(','));
  return `${location.origin}${location.pathname}?${q}`;
}

// @ts-check
// The basic HUD (plan 7.4, G4 part): clocks, position, the camera's observer and speed, light shifts, frame time and
// cubemap state. Units are M (G = c = 1); physical units come in G7.

import { innerProduct } from '../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { zamo } from '../physics/observers.js';

const DEG = 180 / Math.PI;
const FAMILY = /** @type {Record<string, string>} */ ({ zamo: 'ZAMO', static: 'static observer', circularPro: 'prograde circular orbit', circularRetro: 'retrograde circular orbit' });

/**
 * @param {{tau: number, family: string, speed: number}} free
 * @param {{pos: number[], g: number[][]}} tracer the camera in tracer coordinates
 * @param {number[]} uT the observer's 4-velocity (tracer coordinates)
 * @param {(d: number[]) => number} shift ship factor for a look direction (f, right, up)
 * @param {{fps: number, p90: number, refreshes: number, idle: boolean, last: any, staleness: any, paused: boolean, note: string}} st
 */
export function hudLines(free, tracer, uT, shift, st) {
  const [t, r, th] = tracer.pos;
  const z = zamo(tracer.g);
  const gamma = z ? -innerProduct(tracer.g, uT, z.u) : NaN;
  const v = Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma)));
  const ahead = shift([1, 0, 0]), behind = shift([-1, 0, 0]);
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const avg = dirs.map(shift).reduce((a, b) => a + b, 0) / dirs.length;
  const f = (/** @type {number} */ x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  const lines = [
    `τ ${f(free.tau, 1)} M   t ${f(t, 1)} M   dt/dτ ${f(uT[0], 3)}${st.paused ? '   ⏸ paused' : ''}`,
    `r ${f(r, r < 1 ? 4 : 2)} M   θ ${f(th * DEG, 1)}° (latitude ${f(90 - th * DEG, 1)}°)`,
    `riding with: ${FAMILY[free.family] ?? free.family}   v vs ZAMO ${f(v, 3)} c (γ ${f(gamma, 3)})`,
    `light ahead ×${f(ahead)}   behind ×${f(behind)}   sky average ×${f(avg)}`,
    `${f(st.fps, 0)} fps (p90 ${f(st.p90, 1)} ms)   ${st.idle ? 'view up to date' : 'refreshing'}${st.last ? ` · last cubemap ${(st.last.wallMs / 1000).toFixed(2)} s` : ''}   speed ${f(free.speed, 2)} r/s`,
  ];
  if (st.note) lines.push(`⚠ ${st.note}`);
  return lines;
}

export const HELP_HTML = `<h2>Flying</h2>
<table>
<tr><th>look around</th><td>click the view, then move the mouse (Esc releases it); or drag</td></tr>
<tr><th>move</th><td>W / S forward and back, A / D left and right, R / F up and down</td></tr>
<tr><th>roll</th><td>Q / E</td></tr>
<tr><th>speed</th><td>mouse wheel (a fraction of your distance from the centre per second)</td></tr>
<tr><th>pause</th><td>P</td></tr>
<tr><th>this help</th><td>?</td></tr>
<tr><th>gamepad</th><td>left stick moves, right stick looks, triggers up and down, bumpers roll, d-pad speed, start pauses</td></tr>
<tr><th>touch</th><td>left half of the screen: move; right half: look</td></tr>
</table>
<h2>What you see</h2>
<p>The view is ray traced: light bends around the black hole or fuzzball, so you see the disc above and below the hole
and the sky distorted around it. Colours are true: the disc glows as a blackbody, and the light you receive is shifted by
gravity and by your motion (the "light ahead / behind" factors in the HUD; above 1 is bluer and brighter). You see
everything as it was when its light left: the disc's flicker reaches you late, and later from its far side.</p>
<p>You ride with a local observer: a ZAMO (no angular momentum: it is dragged around a spinning hole), a static observer
(hovering: impossible inside a spinning hole's ergoregion), or a circular orbit. Each sees the same light with different
shifts and directions.</p>
<p>Time runs at the "time rate" in units of M (the hole's mass in time units: 21 s for Sgr A*). Your own clock (τ) and the
outside coordinate clock (t) run at different rates near the hole.</p>`;

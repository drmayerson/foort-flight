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
<h2>The spaceship</h2>
<p>Choose a scenario, or "Board a ship". Engines off, you fall freely along a geodesic: you feel weightless. It takes
thrust to <i>not</i> follow one (to hover, for example).</p>
<table>
<tr><th>main engine</th><td>Shift (hold): forward, at the thrust level</td></tr>
<tr><th>thrusters</th><td>W / S, A / D, R / F: forward/back, left/right, up/down at 20% of the level</td></tr>
<tr><th>turn</th><td>mouse (Q / E roll)</td></tr>
<tr><th>thrust level</th><td>mouse wheel</td></tr>
<tr><th>assists (toggle)</th><td>1 stop turning · 2 point prograde · 3 retrograde · 4 at the hole · 5 away from it · 6 hover here · 7 circularize · 8 match the ZAMO</td></tr>
<tr><th>time warp</th><td>, and . (off while thrusting)</td></tr>
<tr><th>map</th><td>M: a flat coordinate map with your predicted path (dashed; red if it ends in the hole)</td></tr>
</table>
<p>The HUD shows your clock τ and the outside clock t, your speed against the local ZAMO, the thrust in units of
c⁴/GM and in g for a ship near Sgr A*, the tidal stretching across a 100 m ship, and whether your orbit is bound,
plunging or escaping.</p>
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

/** acceleration unit c^4/(GM) in m/s^2 for Sgr A* (4.297e6 solar masses; F7: g-loads shown for Sgr A*) */
export const SGRA = { accel: 2.99792458e8 ** 2 / (4.297e6 * 1476.625038), metersPerM: 4.297e6 * 1476.625038 };
const G0 = 9.80665;

/**
 * The physical-mode HUD lines (plan 7.4): clocks, position, speed vs the ZAMO, thrust (c^4/GM and g for Sgr A*), light
 * shifts, orbit status, tidal acceleration across a 100 m ship (Sgr A*), assist and warp; expert: E, L_z, Q, integrator.
 * @param {any} o
 */
export function hudPhysicalLines(o) {
  const f = (/** @type {number} */ x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  const e = (/** @type {number} */ x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : '–');
  const [t, r, th] = o.pos;
  const thrust = Math.hypot(...o.acc);
  const lines = [
    `τ ${f(o.tau, 1)} M   t ${f(t, 1)} M   dt/dτ ${f(o.dtdtau, 3)}   warp ${o.warp}×${o.warpLimited ? ' (limited)' : ''}${o.paused ? '   ⏸ paused' : ''}`,
    `r ${f(r, r < 1 ? 4 : 2)} M   θ ${f(th * 180 / Math.PI, 1)}°   v vs ZAMO ${f(o.v, 3)} c (γ ${f(o.gamma, 3)})   orbit: ${o.orbit}`,
    `thrust ${e(thrust)} c⁴/GM = ${e(thrust * SGRA.accel / G0)} g at Sgr A*   level ${e(o.level)} (wheel)   Δv ${f(o.dv, 3)} c`,
    `light ahead ×${f(o.ahead)}   behind ×${f(o.behind)}   sky average ×${f(o.avg)}`,
    `tidal over 100 m: ${e(o.tidal * (100 / SGRA.metersPerM) * SGRA.accel / G0)} g at Sgr A*${o.tidal * (100 / SGRA.metersPerM) * SGRA.accel / G0 > 1e3 ? '  ⚠ spaghettification' : ''}`,
    `${f(o.fps, 0)} fps (p90 ${f(o.p90, 1)} ms)   ${o.idle ? 'view up to date' : 'refreshing'}${o.radii ? `   ${o.radii}` : ''}`,
  ];
  if (o.assist) lines.push(`▶ assist: ${o.assist}`);
  if (o.expert) lines.push(`E ${f(o.E, 9)}   L_z ${f(o.L, 9)}${Number.isFinite(o.Q) ? `   Q ${f(o.Q, 9)}` : ''}   |u·u+1| ${e(o.uu, 1)}   triad ${e(o.ortho, 1)}`);
  if (o.note) lines.push(`⚠ ${o.note}`);
  return lines;
}

/** explanations of the ending events (plan 4.2, F2, F3) */
export const ENDINGS = /** @type {Record<string, {title: string, text: string}>} */ ({
  horizon: { title: 'You crossed the event horizon', text: 'From here every future leads inwards; no signal, and no ship, can come back out. Your own clock reached the horizon in a finite time, while the outside clock (t) ran away towards infinity. (Seeing the inside is for a later stage of the game.)' },
  throat: { title: 'Down the throat', text: 'At λ = 0 the fuzzball\'s cap has receded down an infinitely long throat: this is a black hole, with its horizon at the bottom. Your fall reached it in finite proper time; there is no way back.' },
  'singularity-center': { title: 'You hit a D6 brane centre', text: 'In the four-dimensional description used here the fuzzball\'s sources are singular. In the full string theory they are smooth: the extra dimensions cap off. The game cannot follow you there.' },
  'singularity-ring': { title: 'You hit the D0 ring', text: 'The fuzzball\'s ring of D0 branes is singular in the four-dimensional description, smooth in the full string theory. The game cannot follow you there.' },
  escape: { title: 'You escaped', text: 'You are 2000 M from the centre and moving away. Restart the scenario to return.' },
  numerical: { title: 'The integrator failed', text: 'The last good state was kept. Please restart.' },
});

/**
 * Draw direction markers on a 2D overlay: each {d: body direction (forward, right, up), shape, label}.
 * @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h @param {number} tanX @param {number} tanY
 * @param {{d: number[], shape: 'pro'|'retro'|'hole', label: string}[]} list
 */
export function drawMarkers(ctx, w, h, tanX, tanY, list) {
  ctx.clearRect(0, 0, w, h);
  const s = devicePixelRatio || 1;
  ctx.lineWidth = 1.5 * s;
  ctx.font = `${11 * s}px system-ui`;
  for (const m of list) {
    const [fw, rt, up] = m.d;
    if (!(fw > 1e-3)) continue;
    const x = w / 2 + (rt / fw) / tanX * w / 2, y = h / 2 - (up / fw) / tanY * h / 2;
    if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
    const R = 8 * s;
    ctx.strokeStyle = m.shape === 'hole' ? 'rgba(255, 140, 140, 0.9)' : 'rgba(150, 255, 170, 0.9)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
    if (m.shape === 'pro') { ctx.beginPath(); ctx.arc(x, y, 2 * s, 0, 7); ctx.fill(); }
    if (m.shape === 'retro') { ctx.beginPath(); ctx.moveTo(x - R * 0.6, y - R * 0.6); ctx.lineTo(x + R * 0.6, y + R * 0.6); ctx.moveTo(x + R * 0.6, y - R * 0.6); ctx.lineTo(x - R * 0.6, y + R * 0.6); ctx.stroke(); }
    if (m.shape === 'hole') { ctx.beginPath(); ctx.moveTo(x - R * 1.4, y); ctx.lineTo(x - R, y); ctx.moveTo(x + R, y); ctx.lineTo(x + R * 1.4, y); ctx.stroke(); }
    ctx.fillText(m.label, x + R + 3 * s, y - R);
  }
}

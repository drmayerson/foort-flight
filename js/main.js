// @ts-check
// FOORT Flight (G4: free mode). Bootstrap and the frame loop: input -> free camera -> renderer -> HUD.
import { checkWebGL2, noWebGL2Message } from './gl/context.js';
import { createRenderer } from './gl/renderer.js';
import { createSpacetime } from './physics/spacetime.js';
import { freeStart, freeStep, freeFrame, allowed } from './game/freeMode.js';
import { createControls } from './game/controls.js';
import { hudLines, HELP_HTML } from './game/hud.js';
import { buildPanel } from './ui/panels.js';
import { loadState, saveState, shareUrl, clearState } from './ui/persistence.js';
import { summarize } from './gpu/timing.js';
import { SKY_PICTURES } from '../vendor/foort-gpu/js/sky.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DEG = Math.PI / 180;

/** @param {Record<string, any>} s */
const spacetimeOf = (s) => (s.spacetime === 'kerr' ? createSpacetime('kerr', { a: Number(s.a) })
  : s.spacetime === 'st3crBH' ? createSpacetime('st3crBH', {}) : createSpacetime('st3cr', { lambda: Number(s.lambda) }));

/** renderer settings from the game settings @param {Record<string, any>} s */
const renderSettings = (s) => ({
  faceN: Number(s.faceN), tier: s.tier, fov: Number(s.fov) * DEG, colorMode: Number(s.color), skyMode: Number(s.sky), sigmaN: Number(s.sigmaN),
  T0: Number(s.T0), exposure: Number(s.exposure), starBrightness: Number(s.starBrightness), inset: !!s.inset,
  em: { mu: Number(s.mu), gamma: Number(s.gamma), sigma: Number(s.sigma), p: 3, fudge: 1, maxPasses: 0, circumferential: true },
});

async function main() {
  const check = checkWebGL2();
  if (!check.ok) { $('fatal').innerHTML = noWebGL2Message(check); $('fatal').hidden = false; document.body.dataset.ready = 'error'; return; }
  const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
  const { settings, camera } = loadState();
  let S = spacetimeOf(settings);
  /** a start that suits the object: outside the disc, looking at the centre */
  const start = () => freeStart(S, { r: 15, theta: 80 * DEG, family: String(settings.family) });
  let free = start();
  if (camera && camera.spacetime === settings.spacetime && camera.X && !allowed(S, camera.X)) {
    free = { ...free, X: camera.X, fwd: camera.fwd ?? free.fwd, up: camera.up ?? free.up, speed: camera.speed ?? free.speed, tau: camera.tau ?? 0 };
  }
  free.family = String(settings.family);

  const renderer = await createRenderer(canvas);
  renderer.setSpacetime(S);
  renderer.configure(renderSettings(settings));
  const loadPicture = () => {
    const pic = SKY_PICTURES[/** @type {keyof typeof SKY_PICTURES} */ (settings.picture)] ?? SKY_PICTURES['deep-field'];
    const img = new Image();
    img.onload = () => renderer.setSkyPicture(img);
    img.src = new URL(`../vendor/foort-gpu/sky/${pic.file}`, import.meta.url).href;
    $('credit').textContent = Number(settings.sky) === 2 ? `Sky: ${pic.credit.en}` : '';
  };
  loadPicture();

  // the canvas follows its box (device pixels, capped so the display pass stays cheap on large screens)
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    const k = Math.sqrt(Math.min(1, 1.6e6 / (w * h)));
    w = Math.round(w * k); h = Math.round(h * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const controls = createControls(canvas, { lookPerPixel: () => Number(settings.fov) * DEG / Math.max(canvas.clientWidth, 1) * 0.8 });
  let paused = false, note = '', help = false;
  const toggleHelp = (/** @type {boolean} */ on) => { help = on; $('help').hidden = !on; };
  $('help').innerHTML = HELP_HTML + '<p><button id="helpClose">Close</button></p>';
  $('helpClose').onclick = () => toggleHelp(false);
  $('helpBtn').onclick = () => toggleHelp(!help);

  buildPanel($('panel'), settings, (id, apply) => {
    if (apply === 'scene') { S = spacetimeOf(settings); renderer.setSpacetime(S); free = { ...start(), speed: free.speed }; }
    if (apply === 'render' || apply === 'scene') renderer.configure(renderSettings(settings));
    if (id === 'family') free.family = String(settings.family);
    if (id === 'picture' || id === 'sky') loadPicture();
    saveState(settings, { spacetime: settings.spacetime, ...free });
  });
  $('share').onclick = async () => {
    const url = shareUrl(settings, free);
    try { await navigator.clipboard.writeText(url); $('shareNote').textContent = 'link copied'; } catch { $('shareNote').textContent = url; }
  };
  $('reset').onclick = () => { clearState(); location.href = location.pathname; };
  $('restart').onclick = () => { free = { ...start(), speed: free.speed }; };

  /** @type {number[]} */
  const intervals = [];
  let prev = NaN, hudT = 0, saveT = 0;
  /** @type {any} */
  let lastFrame = null;
  const frame = (/** @type {number} */ now) => {
    const dt = Number.isFinite(prev) ? Math.min((now - prev) / 1000, 0.1) : 0;
    if (Number.isFinite(prev)) { intervals.push(now - prev); if (intervals.length > 240) intervals.shift(); }
    prev = now;
    const input = controls.read(dt);
    if (input.actions.has('pause')) paused = !paused;
    if (input.actions.has('help')) toggleHelp(!help);
    if (input.actions.has('escape') && help) toggleHelp(false);
    const step = freeStep(S, free, paused ? { ...input, move: [0, 0, 0] } : input, dt, paused ? 0 : Number(settings.timeRate));
    free = step.state;
    if (step.note) note = step.note;
    const fr = freeFrame(S, free);
    if (fr.note) note = fr.note;
    renderer.frame(now, fr.tracer);
    lastFrame = fr;
    if (now - hudT > 200) {
      hudT = now;
      const iv = summarize(intervals.slice(-120));
      const rs = renderer.stats();
      $('hud').textContent = hudLines(free, fr.tracer, fr.uT, (d) => renderer.shift(d), {
        fps: 1000 / iv.median, p90: iv.p90, refreshes: rs.refreshes, idle: rs.idle, last: rs.lastRefresh, staleness: rs.view?.staleness, paused, note,
      }).join('\n');
      note = '';
    }
    if (now - saveT > 2000) { saveT = now; saveState(settings, { spacetime: settings.spacetime, ...free }); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // test hooks
  /** @type {any} */ (window).__game = {
    settings, renderer,
    state: () => ({ free, tracer: lastFrame?.tracer, uT: lastFrame?.uT }),
    frames: () => summarize(intervals.slice(5)),
    /** place the camera @param {{r: number, theta: number, phi?: number}} o */
    place(o) { free = { ...freeStart(S, { ...o, family: String(settings.family) }), speed: free.speed }; },
    hud: () => $('hud').textContent,
    shareUrl: () => shareUrl(settings, free),
  };
  document.body.dataset.ready = '1';
  // the help opens once, on the first visit
  let seen = true;
  try { seen = !!localStorage.getItem('foort-flight:seen-help'); localStorage.setItem('foort-flight:seen-help', '1'); } catch { seen = false; }
  if (!seen) toggleHelp(true);
}

main().catch((e) => {
  console.error(e);
  $('fatal').textContent = `Start-up failed: ${e?.message ?? e}`;
  $('fatal').hidden = false;
  document.body.dataset.ready = 'error';
});

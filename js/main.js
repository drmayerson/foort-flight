// @ts-check
// FOORT Flight (G4 free mode, G6 physical mode). Bootstrap and the frame loop:
//   input -> free camera or ship -> renderer -> HUD, markers, map.
import { checkWebGL2, noWebGL2Message } from './gl/context.js';
import { createRenderer } from './gl/renderer.js';
import { createSpacetime } from './physics/spacetime.js';
import { freeStart, freeStep, freeFrame, allowed } from './game/freeMode.js';
import { createPhysical, physicalStart, shipFromFree, freeAttitudeFromShip } from './game/physicalMode.js';
import { createControls } from './game/controls.js';
import { hudLines, hudPhysicalLines, HELP_HTML, ENDINGS, drawMarkers } from './game/hud.js';
import { Predictor } from './game/predictor.js';
import { createMap, kerrRadii } from './game/map.js';
import { loadScenarios, buildScenario } from './game/scenarios.js';
import { buildPanel } from './ui/panels.js';
import { loadState, saveState, shareUrl, clearState } from './ui/persistence.js';
import { frameToTracer } from './camera/shipCamera.js';
import { zamo, baseFrame } from './physics/observers.js';
import { shipInvariants } from './physics/ship.js';
import { tidalTensor } from './physics/tidal.js';
import { WARPS } from './game/shipClock.js';
import { innerProduct } from '../vendor/foort-gpu/js/camera/tetradCamera.js';
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
  const overlay = /** @type {HTMLCanvasElement} */ ($('overlay'));
  const octx = /** @type {CanvasRenderingContext2D} */ (overlay.getContext('2d'));
  const { settings, camera } = loadState();
  let S = spacetimeOf(settings);
  const start = () => freeStart(S, { r: 15, theta: 80 * DEG, family: String(settings.family) });
  let free = start();
  if (camera && camera.spacetime === settings.spacetime && camera.X && !allowed(S, camera.X)) {
    free = { ...free, X: camera.X, fwd: camera.fwd ?? free.fwd, up: camera.up ?? free.up, speed: camera.speed ?? free.speed, tau: camera.tau ?? 0 };
  }
  free.family = String(settings.family);
  /** @type {'free'|'physical'} */
  let mode = 'free';
  let P = createPhysical(S);
  /** @type {import('./game/physicalMode.js').PhysicalState|null} */
  let phys = null;
  let predictor = new Predictor(S);
  let ended = '';
  /** @type {any} */
  let scenario = null;

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
  const map = createMap(/** @type {HTMLCanvasElement} */ ($('map')));
  let mapOn = false;

  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    const k = Math.sqrt(Math.min(1, 1.6e6 / (w * h)));
    w = Math.round(w * k); h = Math.round(h * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    overlay.width = Math.round(r.width * (window.devicePixelRatio || 1)); overlay.height = Math.round(r.height * (window.devicePixelRatio || 1));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const controls = createControls(canvas, { lookPerPixel: () => Number(settings.fov) * DEG / Math.max(canvas.clientWidth, 1) * 0.8 });
  let paused = false, note = '', help = false;
  const toggleHelp = (/** @type {boolean} */ on) => { help = on; $('help').hidden = !on; };
  $('help').innerHTML = HELP_HTML + '<p><button id="helpClose">Close</button></p>';
  $('helpClose').onclick = () => toggleHelp(false);
  $('helpBtn').onclick = () => toggleHelp(!help);
  const setMap = (/** @type {boolean} */ on) => { mapOn = on; $('map').hidden = !on; };

  /** switch spacetime (keeps the settings panel in step) @param {any} sp {id, params} */
  const useSpacetime = (sp) => {
    settings.spacetime = sp.id;
    if (sp.id === 'kerr' && sp.params?.a !== undefined) settings.a = sp.params.a;
    if (sp.id === 'st3cr' && sp.params?.lambda !== undefined) settings.lambda = sp.params.lambda;
    S = spacetimeOf(settings);
    renderer.setSpacetime(S);
    P = createPhysical(S);
    predictor = new Predictor(S);
    panel.render();
  };
  const showEnding = (/** @type {string} */ ev) => {
    const E = ENDINGS[ev] ?? { title: ev, text: '' };
    $('ending').innerHTML = `<h2>${E.title}</h2><p>${E.text}</p><p><button id="endRestart">Restart</button> <button id="endFree">Look around (free camera)</button></p>`;
    $('ending').hidden = false;
    $('endRestart').onclick = () => restart();
    $('endFree').onclick = () => { $('ending').hidden = true; leave(); };
  };
  /** free -> physical @param {'observer'|'circular'|'hover'} how */
  const board = (how) => {
    const r = shipFromFree(S, free, how);
    phys = { ...physicalStart(S, r.ship), level: how === 'hover' ? 0.5 : 0.05 };
    if (r.hover) phys = P.engage(phys, 'hover');
    if (r.note) note = r.note;
    mode = 'physical'; ended = ''; $('ending').hidden = true;
    predictor = new Predictor(S);
    settings.mode = 'physical'; panel.render(); updateShipButtons();
  };
  /** physical -> free (keeps the event and attitude) */
  const leave = () => {
    if (phys) {
      const at = freeAttitudeFromShip(phys.ship);
      const X = phys.ship.X;
      // a camera inside a horizon cannot be shown: back to the start position then
      free = allowed(S, X) ? { ...start(), speed: free.speed } : { ...free, X, fwd: at.fwd, up: at.up, tau: phys.ship.tau };
    }
    mode = 'free'; phys = null; ended = '';
    settings.mode = 'free'; panel.render(); updateShipButtons();
  };
  /** @param {any} sc */
  const startScenario = (sc) => {
    scenario = sc;
    useSpacetime(sc.spacetime);
    const b = buildScenario(sc);
    if (sc.timeRate) settings.timeRate = sc.timeRate;
    ended = ''; $('ending').hidden = true;
    if (b.mode === 'physical') {
      phys = { ...physicalStart(S, /** @type {any} */ (b.ship)), level: b.level ?? 0.05 };
      if (b.assist) phys = P.engage(phys, b.assist);
      mode = 'physical';
      free = { ...free, X: /** @type {any} */ (b.ship).X };
    } else { free = { ...(/** @type {any} */ (b.free)), speed: free.speed }; mode = 'free'; phys = null; }
    settings.mode = mode;
    $('notes').innerHTML = `<b>${sc.title}</b> — ${sc.notes} <button class="link" id="notesClose">hide</button>`;
    $('notes').hidden = false;
    $('notesClose').onclick = () => { $('notes').hidden = true; };
    panel.render(); updateShipButtons();
  };
  const restart = () => { if (scenario) startScenario(scenario); else { free = { ...start(), speed: free.speed }; if (mode === 'physical') board('observer'); } };

  const panel = buildPanel($('panel'), settings, (id, apply) => {
    if (apply === 'scene') { useSpacetime({ id: settings.spacetime, params: {} }); free = { ...start(), speed: free.speed }; if (mode === 'physical') board('observer'); scenario = null; }
    if (apply === 'render' || apply === 'scene') renderer.configure(renderSettings(settings));
    if (id === 'family') free.family = String(settings.family);
    if (id === 'picture' || id === 'sky') loadPicture();
    if (id === 'mode') { if (settings.mode === 'physical' && mode === 'free') board('observer'); else if (settings.mode === 'free' && mode === 'physical') leave(); }
    saveState(settings, { spacetime: settings.spacetime, ...free });
  });
  const updateShipButtons = () => { $('boardRow').hidden = mode !== 'free'; $('leaveRow').hidden = mode !== 'physical'; };
  $('boardObs').onclick = () => board('observer');
  $('boardCirc').onclick = () => board('circular');
  $('boardHover').onclick = () => board('hover');
  $('leaveShip').onclick = () => leave();
  updateShipButtons();
  $('share').onclick = async () => {
    const url = shareUrl(settings, free) + (scenario ? `&scenario=${scenario.id}` : '');
    try { await navigator.clipboard.writeText(url); $('shareNote').textContent = 'link copied'; } catch { $('shareNote').textContent = url; }
  };
  $('reset').onclick = () => { clearState(); location.href = location.pathname; };
  $('restart').onclick = () => restart();
  $('mapBtn').onclick = () => setMap(!mapOn);
  // scenarios
  const scenarios = await loadScenarios().catch(() => []);
  const sel = /** @type {HTMLSelectElement} */ ($('scenario'));
  sel.innerHTML = '<option value="">— scenario —</option>' + scenarios.map((s) => `<option value="${s.id}">${s.title}</option>`).join('');
  sel.onchange = () => { const sc = scenarios.find((s) => s.id === sel.value); if (sc) startScenario(sc); sel.value = ''; };
  const qsc = new URLSearchParams(location.search).get('scenario');
  if (qsc) { const sc = scenarios.find((s) => s.id === qsc); if (sc) startScenario(sc); }

  /** @type {number[]} */
  const intervals = [];
  let prev = NaN, hudT = 0, saveT = 0, predT = 0, tidalT = 0, tidal = NaN;
  /** @type {any} */
  let lastFrame = null;
  const frame = (/** @type {number} */ now) => {
    const dt = Number.isFinite(prev) ? Math.min((now - prev) / 1000, 0.1) : 0;
    if (Number.isFinite(prev)) { intervals.push(now - prev); if (intervals.length > 240) intervals.shift(); }
    prev = now;
    const input = controls.read(dt);
    if (input.actions.has('pause')) paused = !paused;
    if (input.actions.has('help')) toggleHelp(!help);
    if (input.actions.has('map')) setMap(!mapOn);
    if (input.actions.has('escape') && help) toggleHelp(false);
    const rate = Number(settings.timeRate);
    /** @type {{pos: number[], frame: any, g: number[][]}} */
    let tr;
    if (mode === 'physical' && phys) {
      if (!ended) {
        phys = P.step(phys, input, dt, paused ? 0 : rate, paused);
        if (phys.assistStatus) note = phys.assistStatus.startsWith('hover unavailable') || phys.assistStatus.includes('needs') || phys.assistStatus.includes('only') ? phys.assistStatus : note;
        if (phys.event) { ended = phys.event; showEnding(ended); }
      }
      const s = phys.ship;
      const pos = S.toTracer(s.X);
      tr = { pos, frame: frameToTracer(S, s.X, { u: s.u, f: s.e[0], right: s.e[1], up: s.e[2] }), g: S.gTracer(pos[1], pos[2]) };
      if (!ended) {
        if (now - predT > 300) { predT = now; predictor.restart(s); }
        predictor.work(1);
        predictor.record(s);
      }
    } else {
      const step = freeStep(S, free, paused ? { ...input, move: [0, 0, 0] } : input, dt, paused ? 0 : rate);
      free = step.state;
      if (step.note) note = step.note;
      const fr = freeFrame(S, free);
      if (fr.note) note = fr.note;
      tr = fr.tracer;
      lastFrame = fr;
    }
    // inside the Kerr horizon nothing can be shown (rendering from inside is out of scope): keep the last view
    if (Number.isFinite(tr.pos[1]) && !(S.id === 'kerr' && tr.pos[1] <= S.rHorizon * 1.005)) renderer.frame(now, tr);
    // markers: prograde / retrograde (motion relative to the ZAMO) and the hole
    const z = zamo(tr.g);
    const tanX = Math.tan(Number(settings.fov) * DEG / 2), tanY = tanX * canvas.height / canvas.width;
    const F = tr.frame, g = tr.g;
    const bodyOf = (/** @type {number[]} */ v) => [innerProduct(g, v, F.f), innerProduct(g, v, F.right), innerProduct(g, v, F.up)];
    /** @type {any[]} */
    const marks = [];
    if (z) {
      const B = baseFrame(g, z.u);
      const gam = -innerProduct(g, z.u, F.u);
      const vz = z.u.map((x, i) => (x + innerProduct(g, z.u, F.u) * F.u[i]) / gam);   // ZAMO velocity seen by us
      const pro = bodyOf(vz).map((x) => -x);
      if (Math.hypot(...pro) > 1e-6 && mode === 'physical') { marks.push({ d: pro, shape: 'pro', label: 'prograde' }, { d: pro.map((x) => -x), shape: 'retro', label: 'retrograde' }); }
      const hole = bodyOf(B.f.map((x, i) => x + innerProduct(g, B.f, F.u) * F.u[i]));
      marks.push({ d: hole, shape: 'hole', label: S.id === 'kerr' || S.id === 'st3crBH' ? 'hole' : 'centre' });
      if (now - hudT > 200) {
        hudT = now;
        const iv = summarize(intervals.slice(-120));
        const rs = renderer.stats();
        const shift = (/** @type {number[]} */ d) => renderer.shift(d);
        let lines;
        if (mode === 'physical' && phys) {
          const s = phys.ship;
          const inv = shipInvariants(S, s);
          if (now - tidalT > 500) { tidalT = now; try { tidal = tidalTensor(S.gShip, s.X, s.u, s.e, Math.max(S.rShip(s.X), 1e-3)).max; } catch { tidal = NaN; } }
          const uT = S.vecToTracer(s.X, s.u);
          const ev = predictor.event;
          const orbit = ev === 'horizon' || ev === 'throat' || ev.startsWith('singularity') ? 'plunging' : ev === 'escape' ? 'escaping' : inv.E < 1 ? 'bound' : 'unbound';
          const R = S.id === 'kerr' ? kerrRadii(S.params.a) : null;
          lines = hudPhysicalLines({
            tau: s.tau, pos: tr.pos, dtdtau: uT[0], warp: WARPS[phys.warpIdx], warpLimited: phys.lastWarp < WARPS[phys.warpIdx] - 1e-9, paused,
            v: Math.sqrt(Math.max(0, 1 - 1 / (gam * gam))), gamma: gam, orbit, acc: phys.lastAcc, level: phys.level, dv: s.dv,
            ahead: shift([1, 0, 0]), behind: shift([-1, 0, 0]), avg: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(shift).reduce((a, b) => a + b, 0) / 6,
            tidal, fps: 1000 / iv.median, p90: iv.p90, idle: rs.idle,
            radii: R ? `photon orbit ${R.photonPro.toFixed(2)} M, ISCO ${R.iscoPro.toFixed(2)} M (prograde)` : '',
            assist: phys.assist ? phys.assistStatus : '', expert: !!settings.__expert, E: inv.E, L: inv.L, Q: inv.Q, uu: inv.uu, ortho: inv.ortho, note,
          });
        } else {
          lines = hudLines(free, tr, /** @type {any} */ (lastFrame).uT, shift, { fps: 1000 / iv.median, p90: iv.p90, refreshes: rs.refreshes, idle: rs.idle, last: rs.lastRefresh, staleness: rs.view?.staleness, paused, note });
        }
        $('hud').textContent = lines.join('\n');
        note = '';
      }
    }
    drawMarkers(octx, overlay.width, overlay.height, tanX, tanY * overlay.height / overlay.width * canvas.width / canvas.height, marks);
    if (mapOn) {
      const X = mode === 'physical' && phys ? phys.ship.X : free.X;
      let vel = null;
      if (mode === 'physical' && phys) { const u = phys.ship.u; const n = Math.hypot(u[1], u[2], u[3]); vel = n > 0 ? [u[1] / n, u[2] / n, u[3] / n] : null; }
      const R = S.id === 'kerr' ? kerrRadii(S.params.a) : null;
      map.draw(S, { X, vel, pred: mode === 'physical' ? predictor.points : [], predEvent: predictor.event, trail: mode === 'physical' ? predictor.trail : [],
        discIn: R ? Math.sqrt(R.iscoPro ** 2 + S.params.a ** 2) : 0.02, discOut: Number(settings.mu) + 5 * Number(settings.sigma) });
    }
    if (now - saveT > 2000) { saveT = now; saveState(settings, { spacetime: settings.spacetime, ...free }); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // test hooks
  /** @type {any} */ (window).__game = {
    settings, renderer,
    state: () => ({ mode, free, phys, ended, tracer: mode === 'physical' && phys ? { pos: S.toTracer(phys.ship.X) } : lastFrame?.tracer, uT: lastFrame?.uT, predEvent: predictor.event }),
    frames: () => summarize(intervals.slice(5)),
    place(/** @type {{r: number, theta: number, phi?: number}} */ o) { free = { ...freeStart(S, { ...o, family: String(settings.family) }), speed: free.speed }; },
    hud: () => $('hud').textContent,
    shareUrl: () => shareUrl(settings, free),
    scenarios: () => scenarios.map((s) => s.id),
    start: (/** @type {string} */ id) => { const sc = scenarios.find((s) => s.id === id); if (sc) startScenario(sc); return !!sc; },
    board, leave,
    setRate: (/** @type {number} */ r) => { settings.timeRate = r; },
  };
  document.body.dataset.ready = '1';
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

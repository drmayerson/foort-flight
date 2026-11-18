// @ts-check
// Input (plan 7.2, F9): keyboard + mouse (primary), gamepad, basic touch sticks, merged into one input per frame.
//
// | action                         | keyboard + mouse                         | gamepad                     | touch        |
// | look (yaw, pitch)              | mouse (pointer lock; or drag)            | right stick                 | right stick  |
// | roll                           | Q / E                                    | bumpers                     |              |
// | move: forward/back, left/right | W / S, A / D                             | left stick                  | left stick   |
// | move: up / down                | R / F                                    | right / left trigger        |              |
// | speed (free) / thrust level    | wheel                                    | d-pad up / down             |              |
// | main engine (physical)         | Shift (hold)                             | A                           |              |
// | pause, map, photo, help        | P, M, O, ?                               | start (pause)               |              |
// | screenshot, video              | S is taken by "back": screenshot is K, video is V (DECISIONS G4)         |              |
// | time warp                      | , / .                                    |                             |              |

/**
 * @typedef {Object} FrameInput
 * @property {number[]} move       (forward, right, up), each in [-1, 1]
 * @property {number[]} look       (yaw, pitch) in rad for this frame (positive: right, up)
 * @property {number} roll         rad for this frame (positive: clockwise as seen from behind)
 * @property {number} speedFactor  multiplier for the speed this frame (wheel, d-pad)
 * @property {boolean} engine      main engine held (physical mode)
 * @property {Set<string>} actions one-shot actions this frame: pause, map, photo, help, screenshot, video, warpUp, warpDown, assist1..9
 */

/** @param {HTMLElement} el the view @param {{lookPerPixel: () => number, enabled?: () => boolean}} o */
export function createControls(el, o) {
  const keys = new Set();
  /** @type {Set<string>} */
  const actions = new Set();
  let lookX = 0, lookY = 0, wheel = 0;
  let drag = /** @type {{x: number, y: number}|null} */ (null);
  const enabled = o.enabled ?? (() => true);
  const typing = (/** @type {EventTarget|null} */ t) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

  const ACTION_KEYS = /** @type {Record<string, string>} */ ({ p: 'pause', m: 'map', o: 'photo', '?': 'help', k: 'screenshot', v: 'video', ',': 'warpDown', '.': 'warpUp', Escape: 'escape' });
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || !enabled()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (ACTION_KEYS[k] || ACTION_KEYS[e.key]) { actions.add(ACTION_KEYS[k] ?? ACTION_KEYS[e.key]); e.preventDefault(); return; }
    if (/^[1-9]$/.test(k)) { actions.add(`assist${k}`); return; }
    keys.add(k === 'shift' ? 'Shift' : k);
    if (['w', 'a', 's', 'd', 'r', 'f', 'q', 'e', ' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); if (k === 'Shift') keys.delete('Shift'); });
  window.addEventListener('blur', () => keys.clear());

  // mouse: pointer lock on click (desktop); without it (or while not locked), drag to look
  el.addEventListener('click', () => { if (enabled() && !('ontouchstart' in window) && document.pointerLockElement !== el) el.requestPointerLock?.(); });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === el) { lookX += e.movementX; lookY += e.movementY; }
  });
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && document.pointerLockElement !== el) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    lookX += e.clientX - drag.x; lookY += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('wheel', (e) => { wheel += e.deltaY; e.preventDefault(); }, { passive: false });

  // touch sticks: left half moves, right half looks (a stick appears where the finger lands)
  /** @type {Map<number, {side: 'L'|'R', x0: number, y0: number, x: number, y: number}>} */
  const touches = new Map();
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const r = el.getBoundingClientRect();
    touches.set(e.pointerId, { side: e.clientX - r.left < r.width / 2 ? 'L' : 'R', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => { const t = touches.get(e.pointerId); if (t) { t.x = e.clientX; t.y = e.clientY; } });
  const endTouch = (/** @type {PointerEvent} */ e) => touches.delete(e.pointerId);
  el.addEventListener('pointerup', endTouch);
  el.addEventListener('pointercancel', endTouch);

  const dz = (/** @type {number} */ v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
  let padPrev = /** @type {boolean[]} */ ([]);

  return {
    /** the merged input of this frame @param {number} dt seconds @returns {FrameInput} */
    read(dt) {
      const k = (/** @type {string} */ c) => (keys.has(c) ? 1 : 0);
      const move = [k('w') - k('s'), k('d') - k('a'), k('r') - k('f')];
      const lp = o.lookPerPixel();
      const look = [lookX * lp, -lookY * lp];
      let roll = (k('e') - k('q')) * 1.2 * dt;
      let speedFactor = Math.exp(-wheel * 0.001);
      let engine = keys.has('Shift');
      lookX = 0; lookY = 0; wheel = 0;
      // gamepad (standard mapping)
      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
      if (pad) {
        const ax = pad.axes, b = pad.buttons;
        move[0] += -dz(ax[1] ?? 0); move[1] += dz(ax[0] ?? 0);
        move[2] += (b[7]?.value ?? 0) - (b[6]?.value ?? 0);
        look[0] += dz(ax[2] ?? 0) * 2.0 * dt; look[1] += -dz(ax[3] ?? 0) * 2.0 * dt;
        roll += ((b[5]?.pressed ? 1 : 0) - (b[4]?.pressed ? 1 : 0)) * 1.2 * dt;
        if (b[12]?.pressed) speedFactor *= Math.exp(1.5 * dt);
        if (b[13]?.pressed) speedFactor *= Math.exp(-1.5 * dt);
        engine = engine || !!b[0]?.pressed;
        const now = b.map((x) => x.pressed);
        if (now[9] && !padPrev[9]) actions.add('pause');
        padPrev = now;
      }
      // touch sticks: displacement / 60 px = full deflection
      for (const t of touches.values()) {
        const dx = Math.max(-1, Math.min(1, (t.x - t.x0) / 60)), dy = Math.max(-1, Math.min(1, (t.y - t.y0) / 60));
        if (t.side === 'L') { move[0] += -dy; move[1] += dx; }
        else { look[0] += dx * 1.5 * dt; look[1] += -dy * 1.5 * dt; }
      }
      const out = { move: move.map((v) => Math.max(-1, Math.min(1, v))), look, roll, speedFactor, engine, actions: new Set(actions) };
      actions.clear();
      return out;
    },
    /** touch sticks in use (for drawing them) */
    sticks: () => [...touches.values()],
  };
}

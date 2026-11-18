// @ts-check
// The map (plan 6): a flat coordinate map in the ship's Cartesian coordinates (Kerr-Schild / base), labelled "map —
// not what you see". Top view (x, y) and side view (x, z, rotated so that the ship is in the plane: (rho, z)).
// Draws the horizon and the ergosurface (Kerr), the D6 centres and the D0 ring (ST3Cr), the photon-orbit and ISCO
// circles in the equatorial plane where they exist, the disc's extent, the ship with its velocity, the predicted path
// with the engines off and the trail of the past path. Wheel zooms, drag pans.

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime */

/** Kerr circular-orbit radii (BL): prograde/retrograde photon orbit and ISCO @param {number} a */
export function kerrRadii(a) {
  const ph = (/** @type {number} */ s) => 2 * (1 + Math.cos(2 / 3 * Math.acos(-s * a)));
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a)), z2 = Math.sqrt(3 * a * a + z1 * z1);
  const isco = (/** @type {number} */ s) => 3 + z2 - s * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return { photonPro: ph(1), photonRetro: ph(-1), iscoPro: isco(1), iscoRetro: isco(-1) };
}

/**
 * @param {HTMLCanvasElement} cv
 */
export function createMap(cv) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  let scale = 0, pan = [0, 0];   // pixels per M (0: auto), pan offset in M
  let drag = /** @type {{x: number, y: number}|null} */ (null);
  cv.addEventListener('wheel', (e) => { scale = (scale || autoScale) * Math.exp(-e.deltaY * 0.0015); e.preventDefault(); }, { passive: false });
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const s = scale || autoScale; pan = [pan[0] - (e.clientX - drag.x) * devicePixelRatio / s, pan[1] + (e.clientY - drag.y) * devicePixelRatio / s]; drag = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('dblclick', () => { scale = 0; pan = [0, 0]; });
  let autoScale = 10;

  return {
    /**
     * @param {Spacetime} S
     * @param {{X: number[], vel: number[]|null, pred: number[][], predEvent: string, trail: number[][], discIn: number, discOut: number, kmPerM?: number|null}} d
     */
    draw(S, d) {
      const W = cv.width = Math.round(cv.clientWidth * devicePixelRatio), H = cv.height = Math.round(cv.clientHeight * devicePixelRatio);
      ctx.fillStyle = 'rgba(8, 10, 16, 0.92)'; ctx.fillRect(0, 0, W, H);
      const half = W / 2;
      const rShip = Math.hypot(d.X[1], d.X[2], d.X[3]);
      autoScale = Math.min(half, H) / (2.6 * Math.max(rShip, d.discOut * 0.6, 3 * (S.rHorizon || 0.05)));
      const s = scale || autoScale;
      const views = [
        { name: 'top (x, y)', ox: half / 2, oy: H / 2, pr: (/** @type {number[]} */ p) => [p[0], p[1]] },
        // side: rotate about z so the ship's azimuth is the horizontal axis
        { name: 'side (ρ, z)', ox: half + half / 2, oy: H / 2, pr: (/** @type {number[]} */ p) => { const c = Math.atan2(d.X[2], d.X[1]); return [p[0] * Math.cos(c) + p[1] * Math.sin(c), p[2]]; } },
      ];
      ctx.font = `${11 * devicePixelRatio}px system-ui`;
      for (const [k, v] of views.entries()) {
        const T = (/** @type {number[]} */ p) => { const q = v.pr(p); return [v.ox + (q[0] - pan[0]) * s, v.oy - (q[1] - pan[1]) * s]; };
        ctx.save();
        ctx.beginPath(); ctx.rect(k * half, 0, half, H); ctx.clip();
        const circle = (/** @type {number} */ R, /** @type {string} */ col, /** @type {number[]} */ dash = [], /** @type {boolean} */ eq = true) => {
          ctx.beginPath(); ctx.setLineDash(dash.map((x) => x * devicePixelRatio)); ctx.strokeStyle = col; ctx.lineWidth = devicePixelRatio;
          for (let i = 0; i <= 96; i++) { const t = i / 96 * 2 * Math.PI; const [x, y] = T(eq ? [R * Math.cos(t), R * Math.sin(t), 0] : [R * Math.cos(t), 0, 0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke(); ctx.setLineDash([]);
        };
        // the disc: equatorial annulus
        if (k === 0) {
          ctx.fillStyle = 'rgba(255, 170, 80, 0.10)';
          ctx.beginPath();
          for (const R of [d.discOut, d.discIn]) for (let i = 0; i <= 96; i++) { const t = (R === d.discIn ? -1 : 1) * i / 96 * 2 * Math.PI; const [x, y] = T([R * Math.cos(t), R * Math.sin(t), 0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.fill('evenodd');
        } else {
          ctx.strokeStyle = 'rgba(255, 170, 80, 0.5)'; ctx.lineWidth = 2 * devicePixelRatio;
          for (const sg of [1, -1]) { const [x1, y1] = T([sg * d.discIn, 0, 0]), [x2, y2] = T([sg * d.discOut, 0, 0]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        }
        if (S.id === 'kerr') {
          const a = S.params.a, rp = S.rHorizon;
          const surf = (/** @type {(th: number) => number} */ rOf, /** @type {string} */ fill, /** @type {string} */ stroke) => {
            ctx.beginPath();
            for (let i = 0; i <= 120; i++) {
              const t = i / 120 * 2 * Math.PI, th = k === 0 ? Math.PI / 2 : t, ph = k === 0 ? t : 0;
              const r = rOf(th), rho = Math.sqrt(r * r + a * a) * Math.abs(Math.sin(th));
              const p = k === 0 ? [rho * Math.cos(ph), rho * Math.sin(ph), 0] : [Math.sign(Math.sin(th) || 1) * rho, 0, r * Math.cos(th)];
              const c = Math.atan2(d.X[2], d.X[1]);
              const [x, y] = k === 0 ? T(p) : T([p[0] * Math.cos(c), p[0] * Math.sin(c), p[2]]);
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            ctx.strokeStyle = stroke; ctx.lineWidth = devicePixelRatio; ctx.stroke();
          };
          surf((th) => 1 + Math.sqrt(1 - a * a * Math.cos(th) ** 2), 'rgba(120, 60, 160, 0.25)', 'rgba(170, 110, 220, 0.8)');   // ergosurface
          surf(() => rp, '#000', 'rgba(255, 255, 255, 0.6)');   // horizon
          const R = kerrRadii(a), cyl = (/** @type {number} */ r) => Math.sqrt(r * r + a * a);
          if (k === 0) {
            circle(cyl(R.photonPro), 'rgba(255, 220, 120, 0.7)', [4, 3]); circle(cyl(R.photonRetro), 'rgba(255, 220, 120, 0.4)', [4, 3]);
            circle(cyl(R.iscoPro), 'rgba(120, 220, 160, 0.7)', [2, 3]); circle(cyl(R.iscoRetro), 'rgba(120, 220, 160, 0.4)', [2, 3]);
          }
        } else {
          for (const sg of S.metric.singularities()) {
            if (sg.kind === 'point') { const [x, y] = T([0, 0, sg.r * Math.cos(sg.theta)]); ctx.fillStyle = '#ff6060'; ctx.beginPath(); ctx.arc(x, y, 3 * devicePixelRatio, 0, 7); ctx.fill(); }
            else if (k === 0) circle(sg.r, 'rgba(255, 96, 96, 0.9)');
            else { for (const sgn of [1, -1]) { const [x, y] = T([sgn * sg.r, 0, 0]); ctx.fillStyle = '#ff6060'; ctx.beginPath(); ctx.arc(x, y, 3 * devicePixelRatio, 0, 7); ctx.fill(); } }
          }
        }
        // trail, prediction
        const path = (/** @type {number[][]} */ pts, /** @type {string} */ col, /** @type {number[]} */ dash) => {
          if (pts.length < 2) return;
          ctx.beginPath(); ctx.setLineDash(dash.map((x) => x * devicePixelRatio)); ctx.strokeStyle = col; ctx.lineWidth = 1.5 * devicePixelRatio;
          pts.forEach((p, i) => { const [x, y] = T(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          ctx.stroke(); ctx.setLineDash([]);
        };
        path(d.trail, 'rgba(150, 190, 255, 0.55)', []);
        path(d.pred, d.predEvent === 'horizon' || d.predEvent.startsWith('singularity') || d.predEvent === 'throat' ? 'rgba(255, 110, 110, 0.9)' : 'rgba(150, 230, 255, 0.95)', [6, 4]);
        // ship and velocity
        const sp = [d.X[1], d.X[2], d.X[3]];
        const [sx, sy] = T(sp);
        ctx.fillStyle = '#7cc4ff'; ctx.beginPath(); ctx.arc(sx, sy, 4 * devicePixelRatio, 0, 7); ctx.fill();
        if (d.vel) {
          const L = 0.25 * Math.max(rShip, 1);
          const [vx, vy] = T(sp.map((x, i) => x + L * /** @type {number[]} */ (d.vel)[i]));
          ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 2 * devicePixelRatio; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(vx, vy); ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = '#9aa3b2'; ctx.fillText(v.name, k * half + 8 * devicePixelRatio, H - 8 * devicePixelRatio);
      }
      ctx.fillStyle = '#e6e8ee';
      ctx.fillText('map — not what you see (coordinates; wheel: zoom, drag: pan, double-click: reset)', 8 * devicePixelRatio, 16 * devicePixelRatio);
      ctx.strokeStyle = '#2a3140'; ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, H); ctx.stroke();
      // scale bar (M, and km with physical units)
      const want = 0.25 * half / s, e10 = 10 ** Math.floor(Math.log10(want)), fr = want / e10;
      const L = (fr >= 5 ? 5 : fr >= 2 ? 2 : 1) * e10, px = L * s;
      const bx = W - px - 12 * devicePixelRatio, by = H - 14 * devicePixelRatio;
      ctx.fillStyle = '#e6e8ee'; ctx.fillRect(bx, by, px, 2 * devicePixelRatio);
      const km = d.kmPerM ? ` = ${(L * d.kmPerM).toPrecision(2)} km` : '';
      ctx.fillText(`${+L.toPrecision(3)} M${km}`, bx, by - 4 * devicePixelRatio);
    },
  };
}

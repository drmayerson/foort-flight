// @ts-check
// The map (plan 6): a coordinate map in the ship's Cartesian coordinates (Kerr-Schild / base), labelled "map — not
// what you see". Two panes (side by side, or stacked on a narrow map):
//  - the equatorial plane seen from above (x, y): a 2D slice with the disc, the photon-orbit and ISCO circles, and the
//    paths projected onto it;
//  - a 3D view (2026-11-18, user's request), turned by dragging: the horizon and ergosurface (Kerr) or the centres and
//    ring (ST3Cr), the disc, the circles, the spin axis, faint distance rings in the equatorial plane, the ship with its
//    velocity and a drop line to the equatorial plane, the trail of the past path and the predicted path with the
//    engines off (dashed; red when it ends in the hole). Parts of a path behind the horizon are drawn faint.
// Wheel / pinch zooms, drag pans the slice and turns the 3D view, double-click resets.

/** @typedef {import('../physics/spacetime.js').Spacetime} Spacetime */

/** Kerr circular-orbit radii (BL): prograde/retrograde photon orbit and ISCO @param {number} a */
export function kerrRadii(a) {
  const ph = (/** @type {number} */ s) => 2 * (1 + Math.cos(2 / 3 * Math.acos(-s * a)));
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a)), z2 = Math.sqrt(3 * a * a + z1 * z1);
  const isco = (/** @type {number} */ s) => 3 + z2 - s * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return { photonPro: ph(1), photonRetro: ph(-1), iscoPro: isco(1), iscoRetro: isco(-1) };
}

/** convex hull of 2D points (monotone chain) @param {number[][]} P */
function hull(P) {
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (/** @type {number[]} */ o, /** @type {number[]} */ a, /** @type {number[]} */ b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** @type {number[][]} */ const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const COL = {
  disc: 'rgba(255, 170, 80, 0.13)', discEdge: 'rgba(255, 170, 80, 0.45)', ergo: 'rgba(120, 60, 160, 0.25)', ergoEdge: 'rgba(170, 110, 220, 0.8)',
  horizonEdge: 'rgba(255, 255, 255, 0.6)', photon: 'rgba(255, 220, 120, 0.7)', isco: 'rgba(120, 220, 160, 0.7)', sing: '#ff6060',
  trail: 'rgba(150, 190, 255, 0.6)', pred: 'rgba(150, 230, 255, 0.95)', plunge: 'rgba(255, 110, 110, 0.95)', ship: '#7cc4ff', grid: 'rgba(140, 160, 200, 0.16)',
  text: '#e6e8ee', muted: '#9aa3b2',
};

/**
 * @param {HTMLCanvasElement} cv
 */
export function createMap(cv) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const VIEW0 = { az: -60 * Math.PI / 180, el: 28 * Math.PI / 180 };
  let scale = 0, pan = [0, 0];   // pixels per M (0: auto), pan offset of the slice in M
  let view = { ...VIEW0 };
  let autoScale = 10;
  /** the panes of the last draw, in CSS pixels relative to the canvas @type {{x: number, y: number, w: number, h: number}[]} */
  let panes = [];
  /** @type {Map<number, {x: number, y: number, pane: number}>} */
  const ptrs = new Map();
  let pinch = 0;
  const paneAt = (/** @type {number} */ x, /** @type {number} */ y) => Math.max(0, panes.findIndex((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h));
  cv.addEventListener('wheel', (e) => { scale = (scale || autoScale) * Math.exp(-e.deltaY * 0.0015); e.preventDefault(); }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, pane: paneAt(e.clientX - r.left, e.clientY - r.top) });
    cv.setPointerCapture(e.pointerId);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) scale = (scale || autoScale) * d / pinch;
      pinch = d;
      return;
    }
    if (p.pane === 0) { const s = scale || autoScale; pan = [pan[0] - dx * devicePixelRatio / s, pan[1] + dy * devicePixelRatio / s]; }
    else view = { az: view.az - dx * 0.01, el: Math.max(-1.45, Math.min(1.45, view.el + dy * 0.01)) };
  });
  const up = (/** @type {PointerEvent} */ e) => { ptrs.delete(e.pointerId); pinch = 0; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', () => { scale = 0; pan = [0, 0]; view = { ...VIEW0 }; });

  return {
    /**
     * @param {Spacetime} S
     * @param {{X: number[], vel: number[]|null, pred: number[][], predEvent: string, trail: number[][], discIn: number, discOut: number, kmPerM?: number|null, hint?: string}} d
     */
    draw(S, d) {
      const dpr = devicePixelRatio;
      const W = cv.width = Math.round(cv.clientWidth * dpr), H = cv.height = Math.round(cv.clientHeight * dpr);
      ctx.fillStyle = 'rgba(8, 10, 16, 0.92)'; ctx.fillRect(0, 0, W, H);
      const stacked = W < 1.4 * H;
      const pw = stacked ? W : W / 2, ph = stacked ? H / 2 : H;
      const P = [{ x: 0, y: 0 }, stacked ? { x: 0, y: ph } : { x: pw, y: 0 }].map((o) => ({ ...o, w: pw, h: ph }));
      panes = P.map((p) => ({ x: p.x / dpr, y: p.y / dpr, w: p.w / dpr, h: p.h / dpr }));
      const rShip = Math.hypot(d.X[1], d.X[2], d.X[3]);
      autoScale = Math.min(pw, ph) / (2.6 * Math.max(rShip, d.discOut * 0.6, 3 * (S.rHorizon || 0.05)));
      const s = scale || autoScale;
      const kerr = S.id === 'kerr', a = kerr ? S.params.a : 0;
      const R = kerr ? kerrRadii(a) : null, cyl = (/** @type {number} */ r) => Math.sqrt(r * r + a * a);
      const predCol = d.predEvent === 'horizon' || d.predEvent.startsWith('singularity') || d.predEvent === 'throat' ? COL.plunge : COL.pred;
      ctx.font = `${11 * dpr}px system-ui`;
      ctx.lineJoin = 'round';
      // the scale bar's length (also the 3D view's distance rings)
      const want = 0.25 * pw / s, e10 = 10 ** Math.floor(Math.log10(want)), fr = want / e10;
      const L = (fr >= 5 ? 5 : fr >= 2 ? 2 : 1) * e10;
      const line = (/** @type {number[][]} */ pts, /** @type {string} */ col, /** @type {number} */ wid = 1, /** @type {number[]} */ dash = []) => {
        if (pts.length < 2) return;
        ctx.beginPath(); ctx.setLineDash(dash.map((x) => x * dpr)); ctx.strokeStyle = col; ctx.lineWidth = wid * dpr;
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke(); ctx.setLineDash([]);
      };
      const dot = (/** @type {number[]} */ q, /** @type {number} */ rad, /** @type {string} */ col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], rad * dpr, 0, 7); ctx.fill(); };
      const ring = (/** @type {number} */ Rr, /** @type {number} */ n = 96) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n * 2 * Math.PI; return [Rr * Math.cos(t), Rr * Math.sin(t), 0]; });
      // Kerr surfaces in Kerr-Schild Cartesian coordinates: (sqrt(r^2 + a^2) sin(th) cos(ph), ... sin(ph), r cos(th))
      const surface = (/** @type {(th: number) => number} */ rOf, /** @type {number} */ th, /** @type {number} */ phi) => {
        const r = rOf(th), rho = cyl(r) * Math.sin(th);
        return [rho * Math.cos(phi), rho * Math.sin(phi), r * Math.cos(th)];
      };
      const rErgo = (/** @type {number} */ th) => 1 + Math.sqrt(1 - a * a * Math.cos(th) ** 2), rHor = () => S.rHorizon;

      // ---- pane 1: the equatorial plane from above
      {
        const p = P[0], ox = p.x + p.w / 2, oy = p.y + p.h / 2;
        const T = (/** @type {number[]} */ q) => [ox + (q[0] - pan[0]) * s, oy - (q[1] - pan[1]) * s];
        ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
        ctx.fillStyle = COL.disc; ctx.beginPath();
        for (const [Rr, sg] of [[d.discOut, 1], [d.discIn, -1]]) ring(Rr).forEach((q, i) => { const [x, y] = T([q[0], sg * q[1]]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.fill('evenodd');
        if (kerr && R) {
          for (const [rOf, fill, edge] of /** @type {[(th: number) => number, string, string][]} */ ([[rErgo, COL.ergo, COL.ergoEdge], [rHor, '#000', COL.horizonEdge]])) {
            const pts = Array.from({ length: 121 }, (_, i) => T(surface(rOf, Math.PI / 2, i / 120 * 2 * Math.PI)));
            ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
            ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = dpr; ctx.stroke();
          }
          line(ring(cyl(R.photonPro)).map(T), COL.photon, 1, [4, 3]); line(ring(cyl(R.iscoPro)).map(T), COL.isco, 1, [2, 3]);
          line(ring(cyl(R.photonRetro)).map(T), 'rgba(255, 220, 120, 0.35)', 1, [4, 3]); line(ring(cyl(R.iscoRetro)).map(T), 'rgba(120, 220, 160, 0.35)', 1, [2, 3]);
        } else {
          for (const sg of S.metric.singularities()) {
            if (sg.kind === 'point') dot(T([0, 0]), 3, COL.sing);
            else line(ring(sg.r).map(T), COL.sing, 1.2);
          }
        }
        line(d.trail.map(T), COL.trail, 1.5);
        line(d.pred.map(T), predCol, 1.5, [6, 4]);
        const sp = T([d.X[1], d.X[2]]);
        if (d.vel) { const Lv = 0.25 * Math.max(rShip, 1); line([sp, T([d.X[1] + Lv * d.vel[0], d.X[2] + Lv * d.vel[1]])], COL.ship, 2); }
        dot(sp, 4, COL.ship);
        ctx.restore();
        ctx.fillStyle = COL.muted; ctx.fillText('equatorial plane, from above (drag: move)', p.x + 8 * dpr, p.y + p.h - 8 * dpr);
      }

      // ---- pane 2: 3D
      {
        const p = P[1], ox = p.x + p.w / 2, oy = p.y + p.h / 2;
        const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el);
        const F = [ce * ca, ce * sa, se], Rt = [-sa, ca, 0], U = [-se * ca, -se * sa, ce];
        const dot3 = (/** @type {number[]} */ u, /** @type {number[]} */ v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        /** projection: [x, y, depth (towards the viewer)] */
        const T = (/** @type {number[]} */ q) => [ox + dot3(q, Rt) * s, oy - dot3(q, U) * s, dot3(q, F)];
        // a point is hidden by the horizon (a sphere of its equatorial radius, for the occlusion only)
        const Rh = kerr ? cyl(S.rHorizon) : 0;
        const hidden = (/** @type {number[]} */ q) => {
          if (!kerr) return false;
          const x = dot3(q, Rt), y = dot3(q, U), dd = x * x + y * y;
          return dd < Rh * Rh && dot3(q, F) < Math.sqrt(Rh * Rh - dd);
        };
        /** a 3D path, faint where hidden @param {number[][]} pts @param {string} col @param {number} wid @param {number[]} dash */
        const path3 = (pts, col, wid, dash = []) => {
          if (pts.length < 2) return;
          let run = [T(pts[0])], hid = hidden(pts[0]);
          const flush = () => { ctx.globalAlpha = hid ? 0.25 : 1; line(run, col, wid, dash); ctx.globalAlpha = 1; };
          for (let i = 1; i < pts.length; i++) {
            const h = hidden(pts[i]), q = T(pts[i]);
            run.push(q);
            if (h !== hid) { flush(); run = [q]; hid = h; }
          }
          flush();
        };
        /** an equatorial ring split into its far and near halves (drawn before and after the hole) */
        const halves = (/** @type {number} */ Rr) => {
          const far = [], near = [];
          for (let i = 0; i <= 192; i++) { const t = view.az + Math.PI / 2 + i / 192 * 2 * Math.PI, q = [Rr * Math.cos(t), Rr * Math.sin(t), 0]; (i <= 96 ? far : near).push(q); }
          near.unshift(far[far.length - 1]);
          return { far, near };
        };
        const annulus = (/** @type {'far'|'near'} */ which) => {
          const o = halves(d.discOut)[which], i = halves(d.discIn)[which].slice().reverse();
          ctx.fillStyle = COL.disc; ctx.beginPath();
          [...o, ...i].forEach((q, k) => { const [x, y] = T(q); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          ctx.closePath(); ctx.fill();
        };
        const rings = /** @type {[number, string, number[]][]} */ (R ? [[cyl(R.photonPro), COL.photon, [4, 3]], [cyl(R.iscoPro), COL.isco, [2, 3]]] : []);
        ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
        // distance rings in the equatorial plane, the far halves of the disc and circles
        for (let k = 1; k <= 4; k++) line(ring(k * L).map(T), COL.grid, 1);
        annulus('far');
        for (const [Rr, col, dash] of rings) line(halves(Rr).far.map(T), col, 1, dash);
        // the spin axis (below the hole)
        const zAx = 1.6 * Math.max(Rh, 0.6 * L);
        line([T([0, 0, -zAx]), T([0, 0, 0])], 'rgba(200, 200, 220, 0.35)', 1, [3, 3]);
        if (kerr) {
          for (const [rOf, fill, edge] of /** @type {[(th: number) => number, string, string][]} */ ([[rErgo, COL.ergo, COL.ergoEdge], [rHor, '#05060a', COL.horizonEdge]])) {
            /** @type {number[][]} */ const pts = [];
            for (let i = 0; i <= 24; i++) for (let j = 0; j < 32; j++) pts.push(T(surface(rOf, i / 24 * Math.PI, j / 32 * 2 * Math.PI)));
            const h = hull(pts);
            ctx.beginPath(); h.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
            ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = dpr; ctx.stroke();
          }
          // the horizon's equator, for its tilt
          line(halves(cyl(S.rHorizon)).near.map(T), 'rgba(255, 255, 255, 0.25)', 1);
        } else {
          for (const sg of S.metric.singularities()) {
            if (sg.kind === 'point') dot(T([0, 0, sg.r * Math.cos(sg.theta)]), 3, COL.sing);
            else line(ring(sg.r).map(T), COL.sing, 1.2);
          }
        }
        annulus('near');
        for (const [Rr, col, dash] of rings) line(halves(Rr).near.map(T), col, 1, dash);
        line([T([0, 0, Math.max(Rh, 0.01)]), T([0, 0, zAx])], 'rgba(200, 200, 220, 0.55)', 1);
        { const [x, y] = T([0, 0, zAx]); ctx.fillStyle = COL.muted; ctx.fillText(kerr && a > 0 ? 'spin' : 'z', x + 4 * dpr, y); }
        path3(d.trail, COL.trail, 1.5);
        path3(d.pred, predCol, 1.5, [6, 4]);
        const X3 = [d.X[1], d.X[2], d.X[3]];
        // drop line from the ship to the equatorial plane, and its foot
        const foot = [X3[0], X3[1], 0];
        line([T(X3), T(foot)], 'rgba(124, 196, 255, 0.45)', 1, [2, 2]);
        dot(T(foot), 2, 'rgba(124, 196, 255, 0.6)');
        if (d.vel) { const Lv = 0.25 * Math.max(rShip, 1); path3([X3, X3.map((x, i) => x + Lv * /** @type {number[]} */ (d.vel)[i])], COL.ship, 2); }
        ctx.globalAlpha = hidden(X3) ? 0.35 : 1; dot(T(X3), 4, COL.ship); ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = COL.muted; ctx.fillText('3D (drag: turn)', p.x + 8 * dpr, p.y + p.h - 8 * dpr);
      }

      // frame, title, legend, scale bar, hint
      ctx.strokeStyle = '#2a3140'; ctx.lineWidth = dpr; ctx.beginPath();
      if (stacked) { ctx.moveTo(0, ph); ctx.lineTo(W, ph); } else { ctx.moveTo(pw, 0); ctx.lineTo(pw, H); }
      ctx.stroke();
      ctx.fillStyle = COL.text;
      ctx.fillText('map — not what you see (coordinates; wheel: zoom, double-click: reset)', 8 * dpr, 16 * dpr);
      const legend = /** @type {[string, string, number[]][]} */ ([['path ahead, engines off', predCol, [6, 4]], ['path so far', COL.trail, []]]);
      if (R) legend.push(['photon orbit', COL.photon, [4, 3]], ['ISCO', COL.isco, [2, 3]]);
      legend.forEach(([t, col, dash], i) => {
        const y = (32 + 14 * i) * dpr, x = 8 * dpr;
        line([[x, y - 4 * dpr], [x + 22 * dpr, y - 4 * dpr]], col, 1.5, dash);
        ctx.fillStyle = COL.muted; ctx.fillText(t, x + 28 * dpr, y);
      });
      if (d.hint) { ctx.fillStyle = '#ffd27a'; ctx.fillText(d.hint, 8 * dpr, (32 + 14 * legend.length + 4) * dpr); }
      const px = L * s, bx = W - px - 12 * dpr, by = H - 14 * dpr;
      ctx.fillStyle = COL.text; ctx.fillRect(bx, by, px, 2 * dpr);
      const km = d.kmPerM ? ` = ${(L * d.kmPerM).toPrecision(2)} km` : '';
      ctx.fillText(`${+L.toPrecision(3)} M${km}`, bx, by - 4 * dpr);
    },
  };
}

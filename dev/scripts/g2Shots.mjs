// G2: render observer.html states in Chrome and save screenshots (dev/reports/img/g2/, git-ignored) and their raw
// numbers (dev/reports/g2/shots.json). Usage (from dev/): node scripts/g2Shots.mjs [name ...]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

export const SHOTS = {
  zamo_kerr: { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, v: 0 },
  static_kerr_r4: { spacetime: 'kerr', a: 0.9, kind: 'static', r: 4, theta: 80, v: 0, yaw: 180 },
  boost_g2: { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, v: Math.sqrt(3) / 2, dir: 'prograde', yaw: 90, fov: 90 },
  boost_g5: { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, v: Math.sqrt(24) / 5, dir: 'prograde', yaw: 90, fov: 90 },
  boost_g5_back: { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, v: Math.sqrt(24) / 5, dir: 'prograde', yaw: -90, fov: 90 },
  orbit_kerr_r6: { spacetime: 'kerr', a: 0.9, kind: 'circularPro', r: 6, theta: 90, v: 0, yaw: 90, pitch: -10, fov: 100 },
  fuzzball: { spacetime: 'st3cr', lambda: 0.005, kind: 'zamo', r: 12, theta: 80, v: 0, N: 256 },
  colormap_kerr: { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, v: 0, color: 0 },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const PORT = 8771;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/g2', { recursive: true }); mkdirSync('reports/g2', { recursive: true });
const out = {};
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/observer.html?notrace=1&play=0`);
  await page.waitForSelector('body[data-ready]');
  for (const n of names) {
    const r = await page.evaluate((s) => window.__g2.render({ ...window.__g2.DEFAULTS, play: 0, ...s }), SHOTS[n]);
    if (r.error) { console.log(n, 'error', r.error); continue; }
    await page.waitForTimeout(1200);   // auto-exposure settles
    await page.locator('#view').screenshot({ path: `reports/img/g2/${n}.png` });
    const raw = r.raw, w = r.w, ss = [];
    for (let p = 0; p < raw.length / 4; p++) ss.push(raw[4 * p]);
    ss.sort((x, y) => x - y);
    out[n] = { state: SHOTS[n], trace: { wallMs: r.wallMs, frames: r.frames, program: r.program }, position: r.position, centreShift: r.centreShift, shift: { min: ss[0], median: ss[ss.length >> 1], max: ss[ss.length - 1] } };
    console.log(`${n.padEnd(16)} r ${r.position[1].toFixed(3)} θ ${(r.position[2] * 180 / Math.PI).toFixed(1)}°  centre ×${r.centreShift.toFixed(3)}  shift ${ss[0].toFixed(3)}–${ss[ss.length - 1].toFixed(3)}  trace ${r.wallMs.toFixed(0)} ms`);
  }
  writeFileSync('reports/g2/shots.json', JSON.stringify(out, null, 1));
} finally { await browser.close(); server.kill(); }

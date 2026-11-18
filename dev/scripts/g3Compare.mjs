// G3 validation (plan 5.2): the cubemap renderer against a direct per-pixel trace of the same observer.
// For each case and face resolution: a fresh cubemap at exactly the observer's state (no staleness), drawn at N x N,
// vs the direct trace at N x N, both raw: emission I (FOORT colour-map intensity, before exposure), the ship factor s,
// and the escape direction. Reported: emission L1 (sum |I_c - I_d| / sum I_d), s error, sky error in screen pixels
// (angle between escape directions / pixel angle) on pixels both call escaped and the cube interpolated, and the
// fraction of pixels whose class (escaped or not) differs.
// Usage (from dev/): node scripts/g3Compare.mjs [N] [faceN,...] [case,...]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const DEG = Math.PI / 180;
export const CASES = {
  kerr_static: { spacetime: 'kerr', params: { a: 0.9 }, spec: { kind: 'static', r: 12, theta: 80 * DEG, yaw: 10 * DEG } },
  kerr_orbit: { spacetime: 'kerr', params: { a: 0.9 }, spec: { kind: 'circularPro', r: 8, theta: 90 * DEG, yaw: 60 * DEG, pitch: -5 * DEG } },
  kerr_fast_g2: { spacetime: 'kerr', params: { a: 0.9 }, spec: { kind: 'zamo', r: 12, theta: 80 * DEG, v: Math.sqrt(3) / 2, dir: 'prograde', yaw: 70 * DEG } },
  kerr_fast_g5: { spacetime: 'kerr', params: { a: 0.9 }, spec: { kind: 'zamo', r: 12, theta: 80 * DEG, v: Math.sqrt(24) / 5, dir: 'prograde', yaw: 80 * DEG } },
  fuzz_static: { spacetime: 'st3cr', params: { lambda: 0.005 }, spec: { kind: 'zamo', r: 3, theta: 80 * DEG } },
  fuzz_orbit: { spacetime: 'st3cr', params: { lambda: 0.005 }, spec: { kind: 'circularPro', r: 8, theta: 90 * DEG, yaw: 80 * DEG } },
  fuzz_fast_g2: { spacetime: 'st3cr', params: { lambda: 0.005 }, spec: { kind: 'zamo', r: 6, theta: 80 * DEG, v: Math.sqrt(3) / 2, dir: 'radialIn' } },
};

const N = Number(process.argv[2] ?? 256);
const TIER = process.env.TIER ?? 'normal';
const faceNs = (process.argv[3] ?? '128,256,384').split(',').map(Number);
const names = (process.argv[4] ?? Object.keys(CASES).join(',')).split(',');
const PORT = 8773;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
mkdirSync('reports/g3', { recursive: true });
const pct = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/cubemap.html?play=0&atlas=0`);
  await page.waitForSelector('body[data-ready]');
  for (const name of names) {
    const c = CASES[name];
    for (const faceN of faceNs) {
      const r = await page.evaluate(([cc, n, fn, t]) => window.__g3.compare(cc.spec, { N: n, faceN: fn, spacetime: cc.spacetime, params: cc.params, tier: t }), [c, N, faceN, TIER]);
      let sumD = 0, sumAbs = 0, classDiff = 0, sErr = 0;
      const sky = [];
      for (let p = 0; p < N * N; p++) {
        const Ic = r.cube[4 * p], sc = r.cube[4 * p + 1], thc = r.cube[4 * p + 2], phc = r.cube[4 * p + 3];
        const sd = r.direct[4 * p], Id = r.direct[4 * p + 1], code = r.direct[4 * p + 2];
        sumD += Id; sumAbs += Math.abs(Ic - Id);
        sErr = Math.max(sErr, Math.abs(sc - sd) / sd);
        const escD = code === 2, escC = thc >= 0 || thc === -1 && false;
        if (escD && thc >= 0) {
          const thd = r.dirs[2 * p], phd = r.dirs[2 * p + 1];
          const a = [Math.sin(thc) * Math.cos(phc), Math.sin(thc) * Math.sin(phc), Math.cos(thc)];
          const b = [Math.sin(thd) * Math.cos(phd), Math.sin(thd) * Math.sin(phd), Math.cos(thd)];
          const dot = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
          sky.push(Math.acos(dot) / r.pixelAngle);
        }
        // class: the cube's escaped flag is only known where it interpolated; count disagreement where it did
        if (thc >= 0 && !escD) classDiff++;
      }
      const row = { case: name, N, faceN, emissionL1: sumAbs / Math.max(sumD, 1e-30), sMaxRel: sErr,
        skyPx: { n: sky.length, p50: pct(sky, 0.5), p90: pct(sky, 0.9), p99: pct(sky, 0.99) }, interpOnCaptured: classDiff / (N * N), cube: r.cubeStats };
      rows.push(row);
      console.log(`${name.padEnd(13)} face ${String(faceN).padStart(3)}: emission L1 ${row.emissionL1.toExponential(2)}, s max rel ${sErr.toExponential(1)}, sky px p50 ${row.skyPx.p50.toFixed(2)} p90 ${row.skyPx.p90.toFixed(2)} p99 ${row.skyPx.p99.toFixed(2)} (${sky.length} px); cube ${(r.cubeStats.wallMs / 1000).toFixed(2)} s${r.cubeStats.split ? `, ${r.cubeStats.rounds} rounds` : ''}`);
    }
  }
  writeFileSync(`reports/g3/compare_N${N}.json`, JSON.stringify({ date: new Date().toISOString(), N, rows }, null, 1));
} finally { await browser.close(); server.kill(); }

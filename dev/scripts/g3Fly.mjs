// G3: fly the scripted paths of cubemap.html in Chrome; frame pacing, refreshes, screenshots.
// Usage (from dev/): node scripts/g3Fly.mjs [seconds] [path,...] [query]   (PW_HEADED=1 for a visible window)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const secs = Number(process.argv[2] ?? 6);
const paths = (process.argv[3] ?? 'turn,orbit,dive,flyby').split(',');
const query = process.argv[4] ?? '';
const PORT = 8772;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/g3', { recursive: true }); mkdirSync('reports/g3', { recursive: true });
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/cubemap.html?${query}`);
  await page.waitForSelector('body[data-ready]');
  for (const p of paths) {
    const r = await page.evaluate(([pp, s]) => window.__g3.fly(pp, s), [p, secs]);
    const f = r.frames;
    console.log(`${p.padEnd(6)} ${query}: ${(1000 / f.median).toFixed(1)} fps, frame p90 ${f.p90.toFixed(1)} ms, max ${f.max.toFixed(0)} ms; ${r.refreshes} cubemaps in ${secs} s; last ${JSON.stringify(r.lastRefresh)}`);
    await page.locator('#view').screenshot({ path: `reports/img/g3/${p}${query ? '_' + query.replace(/[^a-z0-9=.]/gi, '_') : ''}.png` });
    out.push({ query, ...r });
  }
  writeFileSync(`reports/g3/fly_${process.env.PW_HEADED ? 'headed' : 'headless'}${query ? '_' + query.replace(/[^a-z0-9=.]/gi, '_') : ''}.json`, JSON.stringify(out, null, 1));
} finally { await browser.close(); server.kill(); }

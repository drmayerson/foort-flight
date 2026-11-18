// G6: play scenarios in the game page: screenshots (reports/img/g6/) and what happened.
// Usage (from dev/): node scripts/g6Smoke.mjs [scenario ...]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['parking-orbit', 'fall-into-kerr'];
const PORT = 8776;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/g6', { recursive: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForSelector('body[data-ready]');
  for (const id of ids) {
    await page.evaluate((i) => window.__game.start(i), id);
    await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
    await page.keyboard.press('m');
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => { const s = window.__game.state(); return { mode: s.mode, ended: s.ended, r: s.tracer?.pos?.[1], pred: s.predEvent }; });
    console.log(id, JSON.stringify(st));
    console.log(await page.evaluate(() => window.__game.hud()));
    await page.screenshot({ path: `reports/img/g6/${id}.png` });
    await page.keyboard.press('m');
  }
} finally { await browser.close(); server.kill(); }

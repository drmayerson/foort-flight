// G4: load the game (index.html), wait for the view, fly forward a little, screenshot (reports/img/g4/).
// Usage (from dev/): node scripts/g4Smoke.mjs [query] [name]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const query = process.argv[2] ?? '', name = process.argv[3] ?? 'game';
const PORT = 8775;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/g4', { recursive: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}`);
  await page.waitForSelector('body[data-ready]');
  await page.waitForFunction(() => window.__game?.renderer.hasCube(), null, { timeout: 60_000 });
  const before = await page.evaluate(() => window.__game.state().tracer.pos);
  await page.locator('#view').focus();
  await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__game.state().tracer.pos);
  console.log('r before', before[1].toFixed(3), 'after W for 1 s', after[1].toFixed(3));
  console.log(await page.evaluate(() => window.__game.hud()));
  await page.screenshot({ path: `reports/img/g4/${name}.png` });
} finally { await browser.close(); server.kill(); }

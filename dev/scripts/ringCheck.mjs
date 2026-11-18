// The photon ring with 256² faces and with the sharpened 512² ones, same view, cropped (reports/img/feedback/ring-*.png).
// Usage (from dev/): node scripts/ringCheck.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8778;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/feedback', { recursive: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForSelector('body[data-ready]');
  await page.keyboard.press('m');
  for (const [tag, refine] of /** @type {[string, boolean][]} */ ([['256', false], ['512', true]])) {
    await page.evaluate((r) => window.__game.renderer.configure({ refine: r }), refine);
    const want = refine ? 512 : 256;
    await page.waitForFunction((n) => window.__game.renderer.stats().N === n && window.__game.renderer.stats().idle, want, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `reports/img/feedback/ring-${tag}.png`, clip: { x: 560, y: 150, width: 260, height: 330 } });
  }
} finally { await browser.close(); server.kill(); }

// 2026-11-18 feedback: the map (on at the start, 3D view, predicted path) and the sharpened cubemap while still.
// Usage (from dev/): node scripts/mapCheck.mjs   -> reports/img/feedback/
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8777;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
mkdirSync('reports/img/feedback', { recursive: true });
try {
  for (const [name, vp, mobile] of [['laptop', { width: 1400, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForSelector('body[data-ready]');
    // free camera, still: the cubemap should sharpen
    await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
    const t0 = Date.now();
    await page.waitForFunction(() => window.__game.renderer.stats().N >= 2 * window.__game.renderer.settings().faceN, null, { timeout: 30_000 }).catch(() => {});
    const st = await page.evaluate(() => { const s = window.__game.renderer.stats(); return { N: s.N, faceN: window.__game.renderer.settings().faceN, hist: window.__game.renderer.history().map((h) => [h.N, Math.round(h.wallMs)]) }; });
    console.log(name, 'free, still:', JSON.stringify(st), `${Date.now() - t0} ms`);
    await page.screenshot({ path: `reports/img/feedback/${name}-free.png` });
    for (const id of ['parking-orbit', 'fall-into-kerr']) {
      await page.evaluate((i) => window.__game.start(i), id);
      await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
      await page.waitForTimeout(3000);
      const s = await page.evaluate(() => { const g = window.__game; return { pred: g.state().predEvent, cpu: g.predCpu(), N: g.renderer.stats().N }; });
      console.log(name, id, JSON.stringify(s));
      await page.screenshot({ path: `reports/img/feedback/${name}-${id}.png`, fullPage: mobile });
    }
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }

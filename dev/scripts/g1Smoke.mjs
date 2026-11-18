// G1: load tracer.html in Chrome, wait for the first trace, report console errors, stats, and a screenshot.
// Usage (from dev/): node scripts/g1Smoke.mjs [query]   e.g. "scene=st3cr_l5e-3&N=256"
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8768, query = process.argv[2] ?? '';
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/tracer.html?${query}`);
  await page.waitForSelector('body[data-ready]', { timeout: 60_000 });
  await page.waitForFunction(() => /trace [0-9.]+ s/.test(document.getElementById('hud')?.textContent ?? '') || document.body.dataset.ready === 'error', null, { timeout: 120_000 });
  console.log(await page.textContent('#hud'));
  console.log(await page.textContent('#error'));
  await page.screenshot({ path: `reports/img/g1/smoke_${query.replace(/[^a-z0-9.=_-]/gi, '_') || 'default'}.png` });
} finally { await browser.close(); server.kill(); }

// G8 acceptance (plan 9, G8 table), on this machine in installed Chrome (headed by default: frame pacing needs a
// visible window). Writes reports/g8/acceptance_<channel>.json.
//   display while turning (Kerr, automatic quality): fps and frame p90 while the mouse turns the view
//   cubemap refresh, Kerr: coarse (the first, N/4) and full 6 x 256^2 while flying in
//   cubemap refresh, fuzzball (lambda = 5e-3): the same
//   ship integration plus prediction: CPU ms per frame in the parking orbit with the map open
// Usage (from dev/): node scripts/g8Acceptance.mjs [--headless] [--channel chrome|msedge]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const channel = arg('--channel', 'chrome'), headless = process.argv.includes('--headless');
const PORT = 8783;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel, headless, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const out = { date: new Date().toISOString(), channel, headless };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForSelector('body[data-ready]');
  out.gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  const hist = () => page.evaluate(() => window.__game.renderer.history());
  const fly = async (ms) => { await page.locator('#view').focus(); await page.keyboard.down('w'); await page.waitForTimeout(ms); await page.keyboard.up('w'); };
  const cubes = async (spacetime) => {
    await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
    await page.waitForTimeout(spacetime === 'kerr' ? 1500 : 8000);
    await fly(spacetime === 'kerr' ? 3000 : 2500);
    await page.waitForTimeout(spacetime === 'kerr' ? 1500 : 15000);
    const h = (await hist()).filter((x) => x.spacetime === spacetime);
    const coarse = h.filter((x) => x.N < 256).map((x) => x.wallMs), full = h.filter((x) => x.N === 256).map((x) => x.wallMs);
    return { coarseMs: coarse[0], fullMs: { n: full.length, median: median(full), max: Math.max(...full) } };
  };
  // Kerr
  out.kerr = await cubes('kerr');
  // turning: drag the mouse across the view for 5 s
  const box = await page.locator('#view').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.__game.frames());
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 5000) { await page.mouse.move(box.x + box.width / 2 + 200 * Math.sin(k / 15), box.y + box.height / 2 + 60 * Math.sin(k / 23)); await page.waitForTimeout(16); k++; }
  await page.mouse.up();
  const f = await page.evaluate(() => window.__game.frames());
  out.turning = { fps: 1000 / f.median, p90: f.p90, max: f.max };
  // fuzzball
  await page.selectOption('#ctl-spacetime', 'st3cr');
  out.fuzzball = await cubes('st3cr');
  // coarse refreshes once compiled and baked: switch back to Kerr, then to the fuzzball again
  await page.selectOption('#ctl-spacetime', 'kerr');
  await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  { const h = await hist(); const i = h.findLastIndex((x) => x.spacetime === 'kerr' && x.N < 256); out.kerr.coarseWarmMs = h[i]?.wallMs; }
  await page.selectOption('#ctl-spacetime', 'st3cr');
  await page.waitForFunction(() => window.__game.renderer.hasCube(), null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  { const h = await hist(); const i = h.findLastIndex((x) => x.spacetime === 'st3cr' && x.N < 256); out.fuzzball.coarseWarmMs = h[i]?.wallMs; }
  // ship CPU: parking orbit with the map open
  await page.evaluate(() => window.__game.start('parking-orbit'));
  // (the map is open from the start)
  await page.waitForTimeout(4000);
  out.shipCpu = await page.evaluate(() => window.__game.shipCpu());
  out.predictionCpu = await page.evaluate(() => window.__game.predCpu());
  console.log(JSON.stringify(out, (kk, v) => (typeof v === 'number' ? +v.toPrecision(4) : v), 1));
  mkdirSync('reports/g8', { recursive: true });
  writeFileSync(`reports/g8/acceptance_${channel}${headless ? '_headless' : ''}.json`, JSON.stringify(out, null, 1));
} finally { await browser.close(); server.kill(); }

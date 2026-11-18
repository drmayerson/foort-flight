// G3 end-to-end: the cubemap renderer flies at frame rate, agrees with a direct trace, and splits long rays exactly.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('./cubemap.html?play=0&atlas=0');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
});

test('turning in Kerr: frame rate and one cubemap', async ({ page }) => {
  const r = await page.evaluate(() => /** @type {any} */ (window).__g3.fly('turn', 3));
  console.log(JSON.stringify({ fps: 1000 / r.frames.median, p90: r.frames.p90, refreshes: r.refreshes, last: r.lastRefresh }));
  expect(1000 / r.frames.median).toBeGreaterThan(45);
});

test('cubemap vs direct trace (Kerr, static observer)', async ({ page }) => {
  const N = 96;
  const r = await page.evaluate(([n]) => /** @type {any} */ (window).__g3.compare({ kind: 'static', r: 12, theta: 80 * Math.PI / 180 }, { N: n, faceN: 128, spacetime: 'kerr', params: { a: 0.9 } }), [N]);
  let sumD = 0, sumAbs = 0, sMax = 0;
  const sky = [];
  for (let p = 0; p < N * N; p++) {
    const Ic = r.cube[4 * p], sc = r.cube[4 * p + 1], thc = r.cube[4 * p + 2], phc = r.cube[4 * p + 3];
    const sd = r.direct[4 * p], Id = r.direct[4 * p + 1], code = r.direct[4 * p + 2];
    sumD += Id; sumAbs += Math.abs(Ic - Id); sMax = Math.max(sMax, Math.abs(sc - sd) / sd);
    if (code === 2 && thc >= 0) {
      const thd = r.dirs[2 * p], phd = r.dirs[2 * p + 1];
      const dot = Math.sin(thc) * Math.sin(thd) * Math.cos(phc - phd) + Math.cos(thc) * Math.cos(thd);
      sky.push(Math.acos(Math.min(1, dot)) / r.pixelAngle);
    }
  }
  sky.sort((a, b) => a - b);
  expect(sMax).toBeLessThan(1e-5);
  expect(sumAbs / sumD).toBeLessThan(0.1);
  expect(sky[Math.floor(0.5 * sky.length)]).toBeLessThan(1);
});

test('ray splitting reproduces the single-pass records (fuzzball)', async ({ page }) => {
  const r = await page.evaluate(() => /** @type {any} */ (window).__g3.splitCheck({ kind: 'zamo', r: 3, theta: 80 * Math.PI / 180 }, { faceN: 48, spacetime: 'st3cr', params: { lambda: 0.005 }, n1: 300 }));
  console.log(JSON.stringify(r));
  expect(r.rounds).toBeGreaterThan(0);
  expect(r.recordCoreIdentical).toBe(1);
  expect(r.identical).toBeGreaterThan(0.99);
});

// G2 end-to-end: the observer page's ship-frame redshift on the GPU (hovering blueshift, flat-limit Doppler) and images.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('./observer.html?notrace=1&play=0');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
});

const render = (page, s) => page.evaluate((st) => { const g = /** @type {any} */ (window).__g2; return g.render({ ...g.DEFAULTS, N: 96, play: 0, ...st }); }, s);
const shifts = (r) => { const s = []; for (let p = 0; p < r.raw.length / 4; p++) s.push(r.raw[4 * p]); return s; };

test('a hovering observer sees the sky blueshifted by 1/sqrt(1 - 2M/r) in every direction (Schwarzschild)', async ({ page }) => {
  for (const r of [4, 10]) {
    const res = await render(page, { spacetime: 'kerr', a: 0, kind: 'static', r, theta: 60, fov: 120 });
    const s = shifts(res), want = 1 / Math.sqrt(1 - 2 / r);
    for (const v of s) expect(Math.abs(v - want) / want).toBeLessThan(2e-5);
    // and the disc is there: some pixels cross it, some escape, some are captured
    const codes = new Set(); for (let p = 0; p < res.raw.length / 4; p++) codes.add(res.raw[4 * p + 2]);
    expect(codes.has(1) && codes.has(2)).toBe(true);
  }
});

test('flat limit: Doppler factor ahead and behind a moving observer', async ({ page }) => {
  for (const v of [0.5, 0.9]) {
    const ahead = await render(page, { spacetime: 'kerr', a: 0, kind: 'static', r: 1e5, theta: 90, v, dir: 'look', yaw: 90 });
    const D = Math.sqrt((1 + v) / (1 - v));
    expect(ahead.centreShift).toBeCloseTo(D, 3);
    // looking back while moving forward: face the other way and move away from where we look
    const back = await render(page, { spacetime: 'kerr', a: 0, kind: 'static', r: 1e5, theta: 90, v, dir: 'retrograde', yaw: 90 });
    expect(back.centreShift).toBeCloseTo(1 / D, 3);
  }
});

test('blackbody and colour-map images render; the ergoregion has no static observer', async ({ page }) => {
  const a = await render(page, { spacetime: 'kerr', a: 0.9, kind: 'zamo', r: 12, theta: 80, color: 1 });
  expect(a.error).toBeUndefined();
  const e = await render(page, { spacetime: 'kerr', a: 0.9, kind: 'static', r: 1.8, theta: 90 });
  expect(e.error).toMatch(/ergoregion/);
  await expect(page.locator('#note')).toContainText('ergoregion');
  const f = await render(page, { spacetime: 'st3cr', lambda: 0.005, kind: 'zamo', r: 12, theta: 80, color: 0 });
  expect(f.program).toContain('trace+g34+reuse');
});

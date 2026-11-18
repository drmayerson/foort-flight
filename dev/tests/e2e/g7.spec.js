// G7 end-to-end: units, teaching cards, automatic quality, screenshots, video, photo mode.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await page.waitForFunction(() => /** @type {any} */ (window).__game.renderer.hasCube(), null, { timeout: 60_000 });
});
const G = (page, f, arg) => page.evaluate(([fs, a]) => new Function('g', 'a', `return (${fs})(g, a)`)(/** @type {any} */ (window).__game, a), [f.toString(), arg]);

test('physical units in the HUD; automatic quality is medium on a desktop', async ({ page }) => {
  await page.selectOption('#ctl-units', 'sgra');
  await expect(page.locator('#hud')).toContainText(/km|AU/, { timeout: 3000 });
  await expect(page.locator('#hud')).toContainText(/ (s|min|h)\b/);
  expect(await G(page, (g) => g.renderer.settings().faceN)).toBe(256);
});

test('screenshot: a PNG with the state and the link inside', async ({ page }) => {
  const dl = page.waitForEvent('download');
  await G(page, (g) => g.screenshot());
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^foort-flight-.*\.png$/);
  const bytes = await G(page, (g) => g.lastPng());
  expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const text = String.fromCharCode(...bytes);
  expect(text).toContain('foort-flight-state');
  expect(text).toContain('foort-gpu-url');
});

test('video: records frames and saves a file', async ({ page }) => {
  await G(page, (g) => g.toggleVideo());
  expect(await G(page, (g) => g.recording())).toBeTruthy();
  // the encoder starts after a while (Chrome: ~3 s the first time); then 60 fixed steps
  await page.waitForFunction(() => (/** @type {any} */ (window).__game.recording()?.frames ?? 0) >= 60, null, { timeout: 30_000 });
  const dl = page.waitForEvent('download');
  await G(page, (g) => g.toggleVideo());
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  await page.waitForFunction(() => /** @type {any} */ (window).__game.lastVideo(), null, { timeout: 10_000 });
  expect((await G(page, (g) => g.lastVideo())).size).toBeGreaterThan(1000);
});

test('photo mode traces every pixel, then lets go', async ({ page }) => {
  await G(page, (g) => g.togglePhoto());
  await page.waitForFunction(() => /** @type {any} */ (window).__game.photo()?.done, null, { timeout: 60_000 });
  await expect(page.locator('#photo')).toContainText('every pixel');
  await G(page, (g) => g.togglePhoto());
  expect(await G(page, (g) => g.photo())).toBeNull();
  await expect(page.locator('#photo')).toBeHidden();
});

test('teaching: the clocks card and the ergoregion card', async ({ page }) => {
  await G(page, (g) => g.start('bh0-dive'));
  await expect(page.locator('#clocks')).toBeVisible();
  await page.waitForFunction(() => /** @type {any} */ (window).__game.state().ended, null, { timeout: 30_000 });
  const c = await G(page, (g) => g.clocks());
  expect((c.t - c.t0) / (c.tau - c.tau0)).toBeGreaterThan(5);
  await G(page, (g) => g.start('ergosphere'));
  await expect(page.locator('#card')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#card')).toContainText("Why can't I hover here?");
});

// G4 end-to-end: the game page in free mode.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { try { if (!sessionStorage.getItem('kept')) { localStorage.clear(); sessionStorage.setItem('kept', '1'); } localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
});

const ready = async (page, url = './') => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await page.waitForFunction(() => /** @type {any} */ (window).__game.renderer.hasCube(), null, { timeout: 60_000 });
};
const r = (page) => page.evaluate(() => /** @type {any} */ (window).__game.state().tracer.pos[1]);

test('flies forward with W, keeps the frame rate, shows the HUD', async ({ page }) => {
  await ready(page);
  const r0 = await r(page);
  await page.locator('#view').focus();
  await page.keyboard.down('w'); await page.waitForTimeout(800); await page.keyboard.up('w');
  expect(await r(page)).toBeLessThan(r0 - 0.5);
  await expect(page.locator('#hud')).toContainText('τ');
  await expect(page.locator('#hud')).toContainText('riding with: ZAMO');
  const f = await page.evaluate(() => /** @type {any} */ (window).__game.frames());
  expect(1000 / f.median).toBeGreaterThan(45);
});

test('a static observer is refused inside the ergoregion (ZAMO shown), accepted outside', async ({ page }) => {
  await ready(page);
  await page.selectOption('#ctl-family', 'static');
  await page.evaluate(() => /** @type {any} */ (window).__game.place({ r: 1.9, theta: Math.PI / 2 }));
  await expect(page.locator('#hud')).toContainText('ergoregion', { timeout: 5000 });
  await page.evaluate(() => /** @type {any} */ (window).__game.place({ r: 6, theta: Math.PI / 2 }));
  await page.waitForTimeout(400);
  await expect(page.locator('#hud')).toContainText('riding with: static observer');
  await expect(page.locator('#hud')).not.toContainText('ergoregion');
});

test('the horizon stops the free camera', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => /** @type {any} */ (window).__game.place({ r: 2.2, theta: 1.4 }));
  await page.locator('#view').focus();
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
  const rp = 1 + Math.sqrt(1 - 0.81);
  expect(await r(page)).toBeGreaterThan(1.05 * rp - 1e-6);
});

test('settings and camera persist across a reload; the link reproduces the camera', async ({ page }) => {
  await ready(page);
  await page.selectOption('#ctl-color', '0');
  await page.evaluate(() => /** @type {any} */ (window).__game.place({ r: 9, theta: 1.2 }));
  const url = await page.evaluate(() => /** @type {any} */ (window).__game.shareUrl());
  await page.waitForTimeout(2300);   // saved every 2 s
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  expect(await page.locator('#ctl-color').inputValue()).toBe('0');
  expect(Math.abs(await r(page) - 9)).toBeLessThan(0.05);
  await page.goto(url.replace(/^https?:\/\/[^/]+\//, './'));
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  expect(Math.abs(await r(page) - 9)).toBeLessThan(0.05);
});

test('expert settings and the fuzzball', async ({ page }) => {
  await ready(page);
  const normal = await page.locator('#panel label.ctl').count();
  await page.check('#ctl-__expert');
  expect(await page.locator('#panel label.ctl').count()).toBeGreaterThan(normal + 5);
  await page.selectOption('#ctl-spacetime', 'st3cr');
  await page.waitForFunction(() => /** @type {any} */ (window).__game.renderer.stats().refreshes > 0, null, { timeout: 60_000 });
  await expect(page.locator('#ctl-lambda')).toBeVisible();
});

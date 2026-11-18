// G6 end-to-end: physical mode, scenarios, assists, ending events, map, mode switching.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('foort-flight:seen-help', '1'); } catch { /* */ } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
});
const G = (page, f, arg) => page.evaluate(([fs, a]) => new Function('g', 'a', `return (${fs})(g, a)`)(/** @type {any} */ (window).__game, a), [f.toString(), arg]);

test('every scenario loads in its mode', async ({ page }) => {
  const ids = await G(page, (g) => g.scenarios());
  expect(ids.length).toBe(9);
  for (const id of ids) {
    expect(await G(page, (g, i) => g.start(i), id)).toBe(true);
    await page.waitForFunction(() => /** @type {any} */ (window).__game.renderer.hasCube(), null, { timeout: 60_000 });
    const st = await G(page, (g) => ({ mode: g.state().mode }));
    expect(st.mode).toBe(id.startsWith('tour') ? 'free' : 'physical');
  }
});

test('falling into Kerr ends at the horizon with the explanation; the lambda = 0 dive ends in the throat', async ({ page }) => {
  await G(page, (g) => g.start('fall-into-kerr'));
  await page.waitForFunction(() => /** @type {any} */ (window).__game.state().ended === 'horizon', null, { timeout: 30_000 });
  await expect(page.locator('#ending')).toBeVisible();
  await expect(page.locator('#ending')).toContainText('event horizon');
  await page.click('#endRestart');
  await expect(page.locator('#ending')).toBeHidden();
  await G(page, (g) => g.start('bh0-dive'));
  await page.waitForFunction(() => /** @type {any} */ (window).__game.state().ended === 'throat', null, { timeout: 30_000 });
  await expect(page.locator('#ending')).toContainText('throat');
});

test('the ergosphere: hovering is refused with the reason', async ({ page }) => {
  await G(page, (g) => g.start('ergosphere'));
  await expect(page.locator('#hud')).toContainText('ergoregion', { timeout: 5000 });
  expect(await G(page, (g) => g.state().phys.assist)).toBeNull();
});

test('hover at 6 M holds the radius in the game', async ({ page }) => {
  await G(page, (g) => g.start('hover-6m'));
  await page.waitForTimeout(500);
  const rs = [];
  for (let k = 0; k < 12; k++) { await page.waitForTimeout(250); rs.push(await G(page, (g) => g.state().tracer.pos[1])); }
  expect(Math.max(...rs.map((r) => Math.abs(r - 6)))).toBeLessThan(1e-3);
  await expect(page.locator('#hud')).toContainText('assist: hover here');
  expect(await G(page, (g) => g.state().phys.ship.tau)).toBeGreaterThan(40);
});

test('engine and assist keys; the map; leaving and boarding', async ({ page }) => {
  await G(page, (g) => g.start('parking-orbit'));
  await page.locator('#view').focus();
  await page.keyboard.down('Shift'); await page.waitForTimeout(500); await page.keyboard.up('Shift');
  expect(await G(page, (g) => g.state().phys.ship.dv)).toBeGreaterThan(0.01);
  await page.keyboard.press('2');
  await expect(page.locator('#hud')).toContainText('point prograde', { timeout: 3000 });
  await page.keyboard.press('2');
  await page.keyboard.press('m');
  await expect(page.locator('#map')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.locator('#map')).toBeHidden();
  const r1 = await G(page, (g) => g.state().tracer.pos[1]);
  await page.click('#leaveShip');
  expect(await G(page, (g) => g.state().mode)).toBe('free');
  expect(Math.abs(await G(page, (g) => g.state().tracer.pos[1]) - r1)).toBeLessThan(0.5);
  await page.click('#boardHover');
  expect(await G(page, (g) => g.state().mode)).toBe('physical');
  await expect(page.locator('#hud')).toContainText('assist: hover here', { timeout: 3000 });
});

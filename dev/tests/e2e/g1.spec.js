// G1 end-to-end: the tracer page traces with the vendored GLSL tracer inside the frame loop.
import { test, expect } from '@playwright/test';

/** @param {Float32Array} rec */
const classes = (rec) => { const c = {}; for (let p = 0; p < rec.length / 24; p++) { const k = Math.round(rec[24 * p]) & 15; c[k] = (c[k] ?? 0) + 1; } return c; };
const decode = (b64) => { const buf = Buffer.from(b64, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); };

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('./tracer.html?notrace=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
});

test('Kerr: a shadow, escaped rays and disc crossings', async ({ page }) => {
  const r = await page.evaluate(() => { const g = /** @type {any} */ (window).__g1; return g.trace(g.sceneView('kerr_a0.94_inc80', 'normal', 128)); });
  const rec = decode(r.records), c = classes(rec);
  expect(c[1]).toBeGreaterThan(0.03 * 128 * 128);   // horizon
  expect(c[2]).toBeGreaterThan(0.5 * 128 * 128);    // escaped
  let crossings = 0;
  for (let p = 0; p < 128 * 128; p++) if (rec[24 * p + 4] > 0) crossings++;
  expect(crossings).toBeGreaterThan(0.1 * 128 * 128);
  expect(r.program).toContain('trace_kerr_analytic');
});

test('fuzzball (tables): traces and the pinhole camera agrees with FOORT\'s', async ({ page }) => {
  const [a, b] = await page.evaluate(async () => {
    const g = /** @type {any} */ (window).__g1, v = g.sceneView('st3cr_l5e-3', 'high', 96);
    return [await g.trace(v, { camera: 'foort' }), await g.trace(v, { camera: 'pinhole' })];
  });
  expect(a.program).toContain('trace+g34+reuse');
  const A = decode(a.records), B = decode(b.records);
  let agree = 0;
  for (let p = 0; p < 96 * 96; p++) if ((Math.round(A[24 * p]) & 15) === (Math.round(B[24 * p]) & 15)) agree++;
  expect(agree / (96 * 96)).toBeGreaterThan(0.99);
});

test('the frame loop keeps its pace while tracing', async ({ page }) => {
  const r = await page.evaluate(() => { const g = /** @type {any} */ (window).__g1; return g.load(g.sceneView('st3cr_l5e-3', 'high', 256), 4); });
  console.log(JSON.stringify({ fps: r.fps, p90: r.frameMs.p90, refresh: r.refreshMs, traces: r.traces, trace: r.traceWallMs.median, sched: r.sched }));
  expect(r.traces).toBeGreaterThan(0);
  // headless Chrome paces frames unevenly (G0: p90 25 ms even when idle); the median is the robust check
  expect(r.fps).toBeGreaterThan(45);
});

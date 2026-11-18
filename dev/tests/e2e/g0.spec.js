// G0 end-to-end tests in Chrome with WebGPU: the landing page, caps.html, latency.html, and the no-WebGPU page.
import { test, expect } from '@playwright/test';

test('about.html reports WebGL2 ready (plan v1.1)', async ({ page }) => {
  await page.goto('./about.html');
  await expect(page.locator('body')).toHaveAttribute('data-gl', 'ready', { timeout: 30_000 });
  await expect(page.locator('#gpu')).toContainText('WebGL2 is ready');
});

test('without float render targets the page explains why and links to FOORT-GPU', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'EXT_color_buffer_float' ? null : orig.call(this, n); };
  });
  await page.goto('./about.html');
  await expect(page.locator('body')).toHaveAttribute('data-gl', 'missing');
  await expect(page.locator('#gpu')).toContainText('cannot run here');
  await expect(page.locator('#gpu a[href*="foort-gpu"]')).toHaveCount(1);
});

test('without WebGL2 the page explains why', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-ignore
    HTMLCanvasElement.prototype.getContext = function (t, o) { return t === 'webgl2' ? null : orig.call(this, t, o); };
  });
  await page.goto('./about.html');
  await expect(page.locator('body')).toHaveAttribute('data-gl', 'missing');
  await expect(page.locator('#gpu')).toContainText('does not offer WebGL2');
});

test('caps.html reports adapter, features and raised limits', async ({ page }) => {
  await page.goto('./caps.html');
  await expect(page.locator('body')).toHaveAttribute('data-done', '1', { timeout: 30_000 });
  const caps = await page.evaluate(() => /** @type {any} */ (window).__caps);
  expect(caps.webgpu.available).toBe(true);
  expect(caps.webgpu.limits.device.maxStorageBufferBindingSize).toBe(caps.webgpu.limits.adapter.maxStorageBufferBindingSize);
  test.info().annotations.push({ type: 'gpu', description: JSON.stringify(caps.webgpu.info) });
});

test('latency.html: hello compute is correct and the measurements complete', async ({ page }) => {
  await page.goto('./latency.html?auto=1&quick=1');
  await expect(page.locator('body')).toHaveAttribute('data-done', /.+/, { timeout: 100_000 });
  const r = await page.evaluate(() => /** @type {any} */ (window).__latency);
  expect(r.webgpuError).toBeUndefined();
  expect(r.hello.ok).toBe(true);
  expect(r.wait.onSubmittedWorkDone.median).toBeGreaterThan(0);
  expect(r.chunks.chunkGpuMs).toBeGreaterThan(0);
  expect(r.frames.length).toBe(4);
  // WebGL2 part
  expect(r.webgl2.error).toBeUndefined();
  expect(r.webgl2.hello.ok).toBe(true);
  expect(r.webgl2.chunks.chunkMs).toBeGreaterThan(0);
  expect(r.webgl2.frames.length).toBe(4);
  console.log(JSON.stringify(r));
});

test('latency.html without WebGPU still finishes, with the WebGL2 part (G0 phone bug)', async ({ page }) => {
  await page.addInitScript(() => {
    const gpu = /** @type {any} */ (navigator).gpu;
    gpu.requestAdapter = async () => null;
  });
  await page.goto('./latency.html?auto=1&quick=1');
  await expect(page.locator('body')).toHaveAttribute('data-done', '1', { timeout: 60_000 });
  await expect(page.locator('#nogpu')).toContainText('needs WebGPU');
  const r = await page.evaluate(() => /** @type {any} */ (window).__latency);
  expect(r.attempts).toHaveLength(3);
  expect(r.webgl2.hello.ok).toBe(true);
  expect(r.webgl2.frames.length).toBe(4);
  await expect(page.locator('#json')).toContainText('no graphics adapter');
});

test('without a core adapter, the compatibility-mode adapter is used', async ({ page }) => {
  await page.addInitScript(() => {
    const gpu = /** @type {any} */ (navigator).gpu;
    const orig = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async (/** @type {any} */ o) => (o?.featureLevel === 'compatibility' ? orig(o) : null);
  });
  await page.goto('./caps.html');
  await expect(page.locator('body')).toHaveAttribute('data-done', '1', { timeout: 30_000 });
  const caps = await page.evaluate(() => /** @type {any} */ (window).__caps);
  expect(caps.webgpu.available).toBe(true);
  expect(caps.webgpu.attempts.at(-1)).toBe('compatibility: adapter');
  console.log('compat:', caps.webgpu.featureLevel, caps.webgpu.limits.device.maxStorageBuffersInFragmentStage);
});

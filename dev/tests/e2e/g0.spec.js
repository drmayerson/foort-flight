// G0 end-to-end tests in Chrome with WebGPU: the landing page, caps.html, latency.html, and the no-WebGPU page.
import { test, expect } from '@playwright/test';

test('index reports WebGPU ready', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-webgpu', 'ready', { timeout: 30_000 });
  await expect(page.locator('#gpu')).toContainText('WebGPU is ready');
});

test('without WebGPU the page explains why and links to FOORT-GPU', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }); });
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-webgpu', 'missing');
  await expect(page.locator('#gpu')).toContainText('needs WebGPU');
  await expect(page.locator('#gpu a[href*="foort-gpu"]')).toHaveCount(1);
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
  expect(r.error).toBeUndefined();
  expect(r.hello.ok).toBe(true);
  expect(r.wait.onSubmittedWorkDone.median).toBeGreaterThan(0);
  expect(r.chunks.chunkGpuMs).toBeGreaterThan(0);
  expect(r.frames.length).toBe(4);
  console.log(JSON.stringify(r));
});

test('latency.html without WebGPU still finishes with a report (G0 phone bug)', async ({ page }) => {
  await page.addInitScript(() => {
    const gpu = /** @type {any} */ (navigator).gpu;
    gpu.requestAdapter = async () => null;
  });
  await page.goto('./latency.html?auto=1&quick=1');
  await expect(page.locator('body')).toHaveAttribute('data-done', 'error', { timeout: 30_000 });
  await expect(page.locator('#nogpu')).toContainText('needs WebGPU');
  const r = await page.evaluate(() => /** @type {any} */ (window).__latency);
  expect(r.attempts).toHaveLength(3);
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

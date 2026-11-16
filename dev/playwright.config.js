import { defineConfig } from '@playwright/test';

const PORT = 8766; // FOORT-GPU's tests use 8765

// WebGPU tests run in installed Chrome (channel 'chrome') so that the real GPU is used; headless Chromium may fall
// back to a software adapter (fine for correctness, not for timing). PW_CHANNEL=msedge or PW_HEADED=1 override.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 2,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: !process.env.PW_HEADED,
    launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
  },
});

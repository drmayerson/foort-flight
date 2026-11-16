// G0: run caps.html and the full latency.html in installed Chrome (WebGPU, real GPU) and save the JSON reports.
// Usage (from dev/): node scripts/g0Report.mjs [--channel chrome|msedge] [--out reports/g0]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const channel = arg('--channel', 'chrome'), out = arg('--out', 'reports/g0'), PORT = 8767;
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel, headless: !process.env.PW_HEADED, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/caps.html`);
  await page.waitForSelector('body[data-done]', { timeout: 30_000 });
  const caps = await page.evaluate(() => window.__caps);
  writeFileSync(`${out}/caps_${channel}.json`, JSON.stringify(caps, null, 1));
  await page.goto(`http://127.0.0.1:${PORT}/latency.html?auto=1`);
  await page.waitForSelector('body[data-done]', { timeout: 120_000 });
  const lat = await page.evaluate(() => window.__latency);
  writeFileSync(`${out}/latency_${channel}.json`, JSON.stringify(lat, null, 1));
  const g = lat.webgl2;
  console.log(JSON.stringify({ gpu: lat.gpu, wait: lat.wait?.onSubmittedWorkDone.median, chunks: lat.chunks?.wallMs, gl: { info: g.info, wait: g.wait?.fencePolled.median, readPx: g.wait?.readPixels1px.median, chunks: g.chunks, frames: g.frames?.map((f) => [f.setting, f.fps, f.frameMs.p90, f.gpuFrameMs?.median, f.estGpuFrameMs, f.chunksPerSecond, f.finalChunks, f.framesInFlight.median]), error: g.error } }));
} finally {
  await browser.close();
  server.kill();
}

// G1: frame pacing while tracing continuously (tracer.html's load hook), per scene. Headed with PW_HEADED=1.
// Usage (from dev/): node scripts/g1Load.mjs [seconds] [scene,...] [tier] [N]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const secs = Number(process.argv[2] ?? 5);
const scenes = (process.argv[3] ?? 'kerr_a0.94_inc17,st3cr_l5e-3,st3cr_l1e-3').split(',');
const tier = process.argv[4] ?? 'normal', N = Number(process.argv[5] ?? 512);
const PORT = 8770;
const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.PW_HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/tracer.html?notrace=1`);
  await page.waitForSelector('body[data-ready="1"]');
  for (const s of scenes) {
    const r = await page.evaluate(([sc, t, n, sec]) => { const g = window.__g1; return g.load(g.sceneView(sc, t, n), sec); }, [s, tier, N, secs]);
    out.push({ scene: s, tier, N, ...r });
    console.log(`${s.padEnd(18)} ${tier} ${N}: ${r.fps.toFixed(1)} fps, frame p90 ${r.frameMs.p90.toFixed(1)} ms, max ${r.frameMs.max.toFixed(0)} ms, refresh ${r.refreshMs.toFixed(1)}; ${r.traces} traces, median ${r.traceWallMs.median.toFixed(0)} ms`);
  }
  mkdirSync('reports/g1', { recursive: true });
  writeFileSync(`reports/g1/load_${process.env.PW_HEADED ? 'headed' : 'headless'}.json`, JSON.stringify(out, null, 1));
} finally { await browser.close(); server.kill(); }

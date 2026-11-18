// G1 test: records of the game's tracer (tracer.html) against FOORT-GPU's own viewer, on FOORT-GPU's quality-gate scene
// set (dev/scripts/gateConfigs.mjs of the FOORT-GPU clone next to this repository, used read-only), per configuration.
//
// Per scene and configuration, at N = 128 (the gate's size):
//   FOORT-GPU viewer (its WebGL2 backend)                                  = reference A
//   ours, FOORT's static camera uniforms (gpuTraceSetup)                  -> expected bit-identical to A
//   ours, the general pinhole camera (js/camera/generalTetrad.js)          -> expected within the float32 noise floor
//   ours, FOORT camera with eps (1 + 1e-6)                                 -> the noise floor itself (b5Exact's definition)
// Timings at 512² (256² for the fuzzball): FOORT-GPU's trace (tiles waited one by one) vs ours in the frame loop.
//
// Usage (from dev/): node scripts/g1Compare.mjs [--configs reference,high,normal] [--scenes name,...] [--noTiming]
// Writes reports/g1/compare.json and prints a table. Needs ../foort-gpu at the vendored commit (checked).
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fgpu = resolve(root, '../foort-gpu');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

// FOORT-GPU must be at the vendored commit with a clean tree, or the comparison means nothing
const vendored = /commit ([0-9a-f]+)/.exec(readFileSync(resolve(root, 'vendor/foort-gpu/VERSION'), 'utf8'))[1];
const head = execSync('git rev-parse HEAD', { cwd: fgpu }).toString().trim();
const dirty = execSync('git status --porcelain -- js shaders', { cwd: fgpu }).toString().trim();
if (head !== vendored || dirty) { console.error(`FOORT-GPU is at ${head}${dirty ? ' with local changes' : ''}; vendored ${vendored}. Aborting.`); process.exit(1); }

const { openViewer } = await import(pathToFileURL(resolve(fgpu, 'dev/scripts/gpuRunner.mjs')).href);
const { sceneSet, GATE_CONFIGS } = await import(pathToFileURL(resolve(fgpu, 'dev/scripts/gateConfigs.mjs')).href);

const configs = arg('--configs', 'reference,high,normal').split(',').filter((c) => c && c !== 'none');
const only = arg('--scenes', '');
const scenes = sceneSet().filter((s) => !only || only.split(',').includes(s.name));
const N = 128, F = 24;

// our page
const PORT = 8769;
const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
// one Playwright only: FOORT-GPU's runner launches Chrome; our page opens in the same browser (a second
// @playwright/test from this repository's node_modules refuses to load)
const viewer = await openViewer();
const page = await (await viewer.page.context().browser().newContext({ viewport: { width: 900, height: 900 } })).newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/tracer.html?notrace=1`);
await page.waitForSelector('body[data-ready="1"]', { timeout: 60_000 });
const ours = async (view, camera = 'foort') => {
  const r = await page.evaluate(([v, c]) => window.__g1.trace(v, { camera: c }), [view, camera]);
  const buf = Buffer.from(r.records, 'base64');
  return { ...r, rec: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
};

/** compare two record arrays */
function compare(A, B) {
  const n = A.length / F;
  let ident = 0, classAgree = 0, stepsAgree = 0, esc = 0, dirBig = 0, crossBig = 0, maxDir = 0;
  const u32a = new Uint32Array(A.buffer, A.byteOffset, A.length), u32b = new Uint32Array(B.buffer, B.byteOffset, B.length);
  for (let p = 0; p < n; p++) {
    const o = F * p;
    let same = true;
    for (let k = 0; k < F; k++) if (u32a[o + k] !== u32b[o + k]) { same = false; break; }
    if (same) ident++;
    const ca = Math.round(A[o]) & 15, cb = Math.round(B[o]) & 15;
    if (ca !== cb) continue;
    classAgree++;
    if (A[o + 1] === B[o + 1]) stepsAgree++;
    if (ca === 2) {
      esc++;
      const d = Math.hypot(A[o + 2] - B[o + 2], Math.sin(A[o + 2]) * (((A[o + 3] - B[o + 3] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI));
      maxDir = Math.max(maxDir, d);
      if (d > 1e-3) dirBig++;
    }
    for (let c = 0; c < 3; c++) {
      const b = o + 4 + 4 * c;
      if ((A[b] > 0) !== (B[b] > 0)) { crossBig++; break; }
      if (A[b] > 0 && (Math.abs(A[b] - B[b]) > 1e-3 * A[b] || Math.abs(A[b + 3] - B[b + 3]) > 1e-3 * Math.abs(A[b + 3]) + 1e-6)) { crossBig++; break; }
    }
  }
  const pct = (x) => +(100 * x / n).toFixed(3);
  return { identical: pct(ident), classAgree: pct(classAgree), stepsAgree: pct(stepsAgree), escDirOver1e3: pct(dirBig), escDirMax: +maxDir.toExponential(2), crossingsOff: pct(crossBig) };
}

const rows = [];
try {
  for (const cfgName of configs) {
    const cfg = GATE_CONFIGS[cfgName];
    for (const s of scenes) {
      const view = { ...cfg.apply(s), N };
      const A = (await viewer.trace(view, { levels: [1] })).rec;
      const same = await ours(view, 'foort');
      const pin = await ours(view, 'pinhole');
      const floor = await ours({ ...view, eps: (view.eps ?? 0.03) * (1 + 1e-6) }, 'foort');
      const row = { config: cfgName, scene: s.name, program: same.program,
        foortCamera: compare(A, same.rec), pinhole: compare(A, pin.rec), floor: compare(same.rec, floor.rec) };
      rows.push(row);
      console.log(`${cfgName.padEnd(9)} ${s.name.padEnd(26)} identical ${String(row.foortCamera.identical).padStart(7)}% | pinhole: ident ${row.pinhole.identical}% class ${row.pinhole.classAgree}% dir>1e-3 ${row.pinhole.escDirOver1e3}% cross ${row.pinhole.crossingsOff}% | floor: class ${row.floor.classAgree}% dir>1e-3 ${row.floor.escDirOver1e3}% cross ${row.floor.crossingsOff}%`);
    }
  }
  // timings
  const timing = [];
  if (!process.argv.includes('--noTiming')) {
    for (const s of scenes) {
      const n = s.fuzzball ? 256 : 512;
      const view = { ...GATE_CONFIGS.normal.apply(s), N: n };
      const tA = [], tB = [], fB = [];
      for (let k = 0; k < 3; k++) {
        const a = await viewer.trace(view, { levels: [1], adaptTiles: true });
        tA.push(a.stats.wallMs);
        const b = await ours(view);
        tB.push(b.wallMs); fB.push(b.frames);
      }
      const t = { scene: s.name, N: n, foortGpuWallMs: Math.min(...tA), oursWallMs: Math.min(...tB), oursFrames: fB[tB.indexOf(Math.min(...tB))] };
      timing.push(t);
      console.log(`timing ${s.name.padEnd(26)} N ${n}: FOORT-GPU ${t.foortGpuWallMs.toFixed(0)} ms, ours ${t.oursWallMs.toFixed(0)} ms in ${t.oursFrames} frames (60 fps display)`);
    }
  }
  mkdirSync(resolve(root, 'dev/reports/g1'), { recursive: true });
  const renderer = viewer.renderer;
  writeFileSync(resolve(root, `dev/reports/g1/${rows.length ? 'compare' : 'timing'}.json`), JSON.stringify({ date: new Date().toISOString(), foortGpu: head, renderer, N, rows, timing }, null, 1));
} finally {
  await viewer.close();
  server.kill();
}

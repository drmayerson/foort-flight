// @ts-check
// G0 WebGPU harness: "hello compute" and the latency / scheduling measurements of plan Section 3.
//
//   hello      a compute shader writes a known function of the index; read back and checked on the CPU
//   wait       the CPU round trip of one tiny submission: await onSubmittedWorkDone, and a 16-byte mapAsync read-back
//   chunks     K equal compute chunks (~2 ms GPU each): waited per chunk, vs submitted separately with one wait at the
//              end, vs one submission; the difference per chunk is the cost of a CPU wait (FOORT-GPU M0: Firefox ~75-100 ms)
//   frames     a requestAnimationFrame loop with N chunks + a display pass per frame, never waiting on the GPU; and an
//              adaptive mode that sizes N from a GPU-time budget (the per-frame scheduler of plan 5.4)
import { GpuTimer, summarize, median } from './timing.js';

const WG = 64;

export const HELLO_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&out)) { return; }
  out[i] = f32(i) * 3.0 + 1.0;
}`;

// A synthetic ray-tracer-like load: per invocation, `iters` steps of a smooth nonlinear map in f32 (FMA-heavy,
// a little divergence). Writes one vec4 so the work cannot be optimised away.
export const BUSY_WGSL = /* wgsl */ `
struct P { n: u32, iters: u32, seed: f32, pad: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> out: array<vec4f>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.n) { return; }
  var x = vec4f(f32(i % 1024u) / 1024.0, f32(i / 1024u) / 1024.0, p.seed, 1.0);
  let h = 0.01;
  var k = 0u;
  loop {
    if (k >= p.iters) { break; }
    let r2 = dot(x.xyz, x.xyz) + 1.0;
    let f = vec4f(x.y, -x.x / r2, sin(x.w) * 0.1, x.z * 0.5);
    x = x + h * f;
    if (r2 > 1e6) { break; }
    k = k + 1u;
  }
  out[i] = x;
}`;

export const DISPLAY_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> rec: array<vec4f>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) v: u32) -> VO {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: VO; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = p; return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = arrayLength(&rec);
  let side = u32(sqrt(f32(n)));
  let ix = min(u32(i.uv.x * f32(side)), side - 1u);
  let iy = min(u32(i.uv.y * f32(side)), side - 1u);
  let r = rec[iy * side + ix];
  return vec4f(0.5 + 0.5 * sin(r.x * 3.0), 0.5 + 0.5 * sin(r.y * 3.0 + 2.0), 0.5 + 0.5 * sin(r.w), 1.0);
}`;

/** @param {GPUDevice} device @param {string} code @param {string} label */
async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error(`${label}: WGSL error ${errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  return module;
}

/** @param {GPUBuffer} buf @param {number} bytes */
async function readBack(device, buf, bytes) {
  const rd = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(buf, 0, rd, 0, bytes);
  device.queue.submit([enc.finish()]);
  await rd.mapAsync(GPUMapMode.READ);
  const out = rd.getMappedRange().slice(0);
  rd.unmap(); rd.destroy();
  return out;
}

/**
 * Hello compute: write out[i] = 3 i + 1 for n values, read back, compare exactly.
 * @param {GPUDevice} device @param {number} [n]
 */
export async function helloCompute(device, n = 1 << 20) {
  const module = await compile(device, HELLO_WGSL, 'hello');
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const buf = device.createBuffer({ size: 4 * n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe); pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(Math.ceil(n / WG));
  pass.end();
  device.queue.submit([enc.finish()]);
  const got = new Float32Array(await readBack(device, buf, 4 * n));
  buf.destroy();
  let bad = 0, firstBad = -1;
  for (let i = 0; i < n; i++) if (got[i] !== Math.fround(i * 3 + 1)) { bad++; if (firstBad < 0) firstBad = i; }
  return { ok: bad === 0, n, bad, firstBad };
}

/** The busy-kernel setup shared by the chunk and frame tests. */
class Busy {
  /** @param {GPUDevice} device @param {GPUComputePipeline} pipe @param {number} n */
  constructor(device, pipe, n) {
    this.device = device; this.pipe = pipe; this.n = n;
    this.out = device.createBuffer({ size: 16 * n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.ubo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.ubo } }, { binding: 1, resource: { buffer: this.out } }] });
    this.setIters(1);
  }

  /** @param {number} iters */
  setIters(iters) {
    this.iters = iters;
    const b = new ArrayBuffer(16);
    new Uint32Array(b, 0, 2).set([this.n, iters]);
    new Float32Array(b, 8, 2).set([0.3, 0]);
    this.device.queue.writeBuffer(this.ubo, 0, b);
  }

  /** @param {GPUCommandEncoder} enc @param {GPUComputePassTimestampWrites} [tw] */
  encode(enc, tw) {
    const pass = enc.beginComputePass(tw ? { timestampWrites: tw } : {});
    pass.setPipeline(this.pipe); pass.setBindGroup(0, this.bg);
    pass.dispatchWorkgroups(Math.ceil(this.n / WG));
    pass.end();
  }

  destroy() { this.out.destroy(); this.ubo.destroy(); }
}

/** @param {GPUDevice} device @param {number} n */
async function makeBusy(device, n) {
  const module = await compile(device, BUSY_WGSL, 'busy');
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  return new Busy(device, pipe, n);
}

/**
 * Round trip of a tiny submission.
 * @param {GPUDevice} device @param {number} [reps]
 */
export async function waitLatency(device, reps = 30) {
  const busy = await makeBusy(device, WG);
  const done = [], mapped = [];
  const rd = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  await device.queue.onSubmittedWorkDone();
  for (let k = 0; k < reps; k++) {
    let t0 = performance.now();
    let enc = device.createCommandEncoder();
    busy.encode(enc);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    done.push(performance.now() - t0);

    t0 = performance.now();
    enc = device.createCommandEncoder();
    busy.encode(enc);
    enc.copyBufferToBuffer(busy.out, 0, rd, 0, 16);
    device.queue.submit([enc.finish()]);
    await rd.mapAsync(GPUMapMode.READ);
    rd.unmap();
    mapped.push(performance.now() - t0);
  }
  rd.destroy(); busy.destroy();
  return { onSubmittedWorkDone: summarize(done), mapAsync16B: summarize(mapped) };
}

/**
 * Time `k` busy chunks by GPU timestamps if possible (else by wall time with one wait). @returns {Promise<number>} ms per chunk
 * @param {GPUDevice} device @param {Busy} busy @param {boolean} ts @param {number} k
 */
async function chunkGpuMs(device, busy, ts, k) {
  if (ts) {
    /** @type {number[]} */
    let res = [];
    const timer = new GpuTimer(device, true, (r) => { res = r.map((x) => x.ms); }, { maxPasses: k, ring: 1 });
    timer.beginFrame();
    const enc = device.createCommandEncoder();
    for (let i = 0; i < k; i++) busy.encode(enc, timer.pass('c'));
    timer.endFrame(enc);
    device.queue.submit([enc.finish()]);
    timer.collect();
    await device.queue.onSubmittedWorkDone();
    for (let i = 0; i < 50 && !res.length; i++) await new Promise((r) => setTimeout(r, 10));
    timer.destroy();
    if (res.length && res.every((x) => x > 0)) return median(res);
  }
  const t0 = performance.now();
  const enc = device.createCommandEncoder();
  for (let i = 0; i < k; i++) busy.encode(enc);
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  return (performance.now() - t0) / k;
}

/**
 * Chunked submission: waited per chunk vs not.
 * @param {GPUDevice} device @param {{timestamps: boolean, targetMs?: number, chunks?: number, n?: number}} o
 */
export async function chunkedVsBatched(device, o) {
  const target = o.targetMs ?? 2, K = o.chunks ?? 24;
  const busy = await makeBusy(device, o.n ?? 256 * 256);
  // calibrate the iterations to about `target` ms of GPU time per chunk
  let iters = 16, ms = 0;
  for (let round = 0; round < 12; round++) {
    busy.setIters(iters);
    ms = await chunkGpuMs(device, busy, o.timestamps, 4);
    if (ms > 0.7 * target && ms < 1.4 * target) break;
    const scale = ms > 0.02 ? target / ms : 8;
    iters = Math.max(1, Math.min(1 << 16, Math.round(iters * Math.min(8, Math.max(0.125, scale)))));
  }
  const chunkMs = await chunkGpuMs(device, busy, o.timestamps, 8);

  /** @param {'waitEach'|'submitEach'|'oneSubmit'} mode */
  const run = async (mode) => {
    await device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    if (mode === 'oneSubmit') {
      const enc = device.createCommandEncoder();
      for (let i = 0; i < K; i++) busy.encode(enc);
      device.queue.submit([enc.finish()]);
    } else {
      for (let i = 0; i < K; i++) {
        const enc = device.createCommandEncoder();
        busy.encode(enc);
        device.queue.submit([enc.finish()]);
        if (mode === 'waitEach') await device.queue.onSubmittedWorkDone();
      }
    }
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  };
  /** @type {Record<string, number[]>} */
  const wall = { waitEach: [], submitEach: [], oneSubmit: [] };
  for (let rep = 0; rep < 3; rep++) for (const m of /** @type {const} */ (['waitEach', 'submitEach', 'oneSubmit'])) wall[m].push(await run(m));
  busy.destroy();
  const w = { waitEach: median(wall.waitEach), submitEach: median(wall.submitEach), oneSubmit: median(wall.oneSubmit) };
  return {
    chunks: K, rays: busy.n, iters, chunkGpuMs: chunkMs, timedBy: o.timestamps ? 'timestamp-query' : 'wall clock',
    wallMs: w,
    gpuBoundMs: K * chunkMs,
    waitCostPerChunkMs: (w.waitEach - w.submitEach) / K,
    waitedSlowdown: w.waitEach / w.submitEach,
  };
}

/**
 * Frame loop: N busy chunks + one display pass per frame, one submission, no waits.
 * mode 'fixed' uses N chunks; 'budget' adapts N so that the measured GPU time stays near `budgetMs`.
 * @param {GPUDevice} device @param {HTMLCanvasElement} canvas
 * @param {{timestamps: boolean, iters: number, n?: number, durationMs?: number,
 *          settings?: ({mode:'fixed', chunks:number} | {mode:'budget', budgetMs:number})[]}} o
 */
export async function frameLoop(device, canvas, o) {
  const busy = await makeBusy(device, o.n ?? 256 * 256);
  busy.setIters(o.iters);
  const ctx = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const dmod = await compile(device, DISPLAY_WGSL, 'display');
  const dpipe = await device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module: dmod, entryPoint: 'vs' },
    fragment: { module: dmod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' },
  });
  const dbg = device.createBindGroup({ layout: dpipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: busy.out } }] });
  const settings = o.settings ?? [{ mode: 'fixed', chunks: 0 }, { mode: 'fixed', chunks: 2 }, { mode: 'fixed', chunks: 8 }, { mode: 'budget', budgetMs: 10 }];
  const results = [];
  for (const s of settings) {
    /** @type {number[]} */ const intervals = [];
    /** @type {number[]} */ const gpuFrame = [];
    /** @type {number[]} */ const cpuSubmit = [];
    let chunks = s.mode === 'fixed' ? s.chunks : 1, totalChunks = 0, lastGpu = NaN;
    const timer = new GpuTimer(device, o.timestamps, (r) => {
      lastGpu = r.reduce((a, x) => a + x.ms, 0);
      gpuFrame.push(lastGpu);
    }, { maxPasses: 128, ring: 4 });
    await device.queue.onSubmittedWorkDone();
    await new Promise((resolve) => {
      const t0 = performance.now();
      let prev = NaN;
      const frame = (/** @type {number} */ now) => {
        if (!Number.isNaN(prev)) intervals.push(now - prev);
        prev = now;
        if (s.mode === 'budget') {
          // the scheduler: grow or shrink the chunk count from the latest GPU time (timestamps), else from the frame interval
          const t = o.timestamps ? lastGpu : intervals.at(-1) ?? NaN;
          const budget = o.timestamps ? s.budgetMs : 16.7;
          if (Number.isFinite(t)) chunks = t > budget ? Math.max(1, Math.floor(chunks * 0.8)) : t < 0.8 * budget ? Math.min(120, chunks + 1) : chunks;
        }
        const c0 = performance.now();
        timer.beginFrame();
        const enc = device.createCommandEncoder();
        for (let i = 0; i < chunks; i++) busy.encode(enc, timer.pass('trace'));
        const rp = enc.beginRenderPass({
          colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
          ...(timer.enabled && timer.cur >= 0 ? { timestampWrites: /** @type {any} */ (timer.pass('display')) } : {}),
        });
        rp.setPipeline(dpipe); rp.setBindGroup(0, dbg); rp.draw(3); rp.end();
        timer.endFrame(enc);
        device.queue.submit([enc.finish()]);
        timer.collect();
        cpuSubmit.push(performance.now() - c0);
        totalChunks += chunks;
        if (now - t0 < (o.durationMs ?? 2500)) requestAnimationFrame(frame); else resolve(null);
      };
      requestAnimationFrame(frame);
    });
    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 50));
    timer.destroy();
    const iv = summarize(intervals.slice(5));
    const secs = intervals.reduce((a, b) => a + b, 0) / 1000;
    results.push({
      setting: s, frames: intervals.length, fps: 1000 / iv.median, frameMs: iv,
      gpuFrameMs: gpuFrame.length ? summarize(gpuFrame.slice(5)) : null,
      cpuSubmitMs: summarize(cpuSubmit), chunksPerSecond: totalChunks / secs, finalChunks: chunks,
      timerDroppedFrames: timer.dropped,
    });
  }
  busy.destroy();
  return results;
}

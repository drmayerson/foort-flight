// @ts-check
// G0 WebGL2 harness: the same questions as js/gpu/latency.js, for the WebGL2 path FOORT-GPU uses (user, 2026-11-16:
// "Do we really need WebGPU?"). Rays are traced in fragment shaders into 6 RGBA32F attachments (24 floats per ray, the
// FOORT-GPU record), in chunks of 256 x 256 rays.
//
//   hello    a fragment shader writes a known function of the pixel into RGBA32F; readPixels; exact comparison
//   wait     the CPU round trip of one tiny draw: a fence polled without blocking (MessageChannel yields), and a
//            synchronous 1-pixel readPixels
//   chunks   chunk cost (wall clock from fences, fixed latency removed), and K chunks waited each vs not
//   frames   requestAnimationFrame with N chunks + a display pass per frame, no waits; and a budget mode for WebGL2
//            without timer queries: the chunk count follows fence lag (frames in flight) and the frame interval
import { summarize, median } from '../gpu/timing.js';

const CHUNK = 256;          // chunk side: 65536 rays, as the WebGPU test
const ATTACH = 6;           // record attachments (24 floats)

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HELLO_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(floor(gl_FragCoord.x) * 3.0 + 1.0, floor(gl_FragCoord.y), 0.0, 1.0); }`;

// the same synthetic ray-tracer-like loop as BUSY_WGSL, writing a 24-float record
const BUSY_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uIters;
uniform float uSeed;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
layout(location = 4) out vec4 o4;
layout(location = 5) out vec4 o5;
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec4 x = vec4(p.x / 1024.0, p.y / 1024.0, uSeed, 1.0);
  for (int k = 0; k < 1000000; k++) {
    if (k >= uIters) break;
    float r2 = dot(x.xyz, x.xyz) + 1.0;
    vec4 f = vec4(x.y, -x.x / r2, sin(x.w) * 0.1, x.z * 0.5);
    x = x + 0.01 * f;
    if (r2 > 1e6) break;
  }
  o0 = x; o1 = 2.0 * x; o2 = x + 1.0; o3 = x.wzyx; o4 = -x; o5 = x * x;
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uRec;
uniform vec2 uSize;
out vec4 o;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy / uSize * ${CHUNK}.0);
  vec4 r = texelFetch(uRec, ij, 0);
  o = vec4(0.5 + 0.5 * sin(r.x * 3.0), 0.5 + 0.5 * sin(r.y * 3.0 + 2.0), 0.5 + 0.5 * sin(r.w), 1.0);
}`;

/** yield to the event loop without the 4 ms clamp of nested setTimeout */
const yieldTask = () => new Promise((resolve) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => resolve(null);
  c.port2.postMessage(0);
});

/** @param {WebGL2RenderingContext} gl @param {string} fs */
function program(gl, fs) {
  const p = /** @type {WebGLProgram} */ (gl.createProgram());
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = /** @type {WebGLShader} */ (gl.createShader(/** @type {number} */ (type)));
    gl.shaderSource(s, /** @type {string} */ (src));
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`GLSL: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** RGBA32F target with n attachments @param {WebGL2RenderingContext} gl @param {number} w @param {number} h @param {number} n */
function target(gl, w, h, n) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex = [];
  for (let i = 0; i < n; i++) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t);
  }
  gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete (0x${st.toString(16)})`);
  return { fb, tex };
}

/** Wait for the GPU without blocking: fence + polling on event-loop yields. @param {WebGL2RenderingContext} gl */
export async function fenceWait(gl) {
  const s = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
  gl.flush();
  while (gl.getSyncParameter(s, gl.SYNC_STATUS) !== gl.SIGNALED) await yieldTask();
  gl.deleteSync(s);
}

/**
 * Open WebGL2 on a canvas and report what the tracer needs.
 * @param {HTMLCanvasElement} canvas
 */
export function openGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return { gl: null, info: { available: false, reason: 'WebGL2 is not available.' } };
  const cbf = !!gl.getExtension('EXT_color_buffer_float');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    available: true,
    renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    colorBufferFloat: cbf,
    timerQueries: !!timer,
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    ready: cbf && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= ATTACH,
  };
  return { gl, timer, info };
}

/** @param {WebGL2RenderingContext} gl */
export function helloGL(gl, n = 1024) {
  const p = program(gl, HELLO_FS);
  const t = target(gl, n, n, 1);
  gl.viewport(0, 0, n, n);
  gl.useProgram(p);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Float32Array(4 * n * n);
  gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, px);
  let bad = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 4 * (y * n + x);
    if (px[k] !== x * 3 + 1 || px[k + 1] !== y) bad++;
  }
  gl.deleteFramebuffer(t.fb);
  t.tex.forEach((x) => gl.deleteTexture(x));
  return { ok: bad === 0, n: n * n, bad };
}

/** The busy-chunk setup. @param {WebGL2RenderingContext} gl */
function makeBusy(gl) {
  const p = program(gl, BUSY_FS);
  const t = target(gl, CHUNK, CHUNK, ATTACH);
  const uIters = gl.getUniformLocation(p, 'uIters'), uSeed = gl.getUniformLocation(p, 'uSeed');
  let iters = 1;
  return {
    t,
    /** @param {number} n */
    setIters(n) { iters = n; },
    get iters() { return iters; },
    draw() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, CHUNK, CHUNK);
      gl.useProgram(p);
      gl.uniform1i(uIters, iters);
      gl.uniform1f(uSeed, 0.3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() { gl.deleteFramebuffer(t.fb); t.tex.forEach((x) => gl.deleteTexture(x)); gl.deleteProgram(p); },
  };
}

/** @param {WebGL2RenderingContext} gl */
export async function waitLatencyGL(gl, reps = 30) {
  const busy = makeBusy(gl);
  busy.setIters(1);
  const fence = [], readPx = [];
  const one = new Float32Array(4);
  await fenceWait(gl);
  for (let k = 0; k < reps; k++) {
    let t0 = performance.now();
    busy.draw();
    await fenceWait(gl);
    fence.push(performance.now() - t0);
    t0 = performance.now();
    busy.draw();
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, one);
    readPx.push(performance.now() - t0);
  }
  busy.destroy();
  return { fencePolled: summarize(fence), readPixels1px: summarize(readPx) };
}

/** Wall time of k chunks with one fence wait. @param {WebGL2RenderingContext} gl @param {ReturnType<typeof makeBusy>} busy @param {number} k */
async function timeChunks(gl, busy, k) {
  await fenceWait(gl);
  const t0 = performance.now();
  for (let i = 0; i < k; i++) busy.draw();
  await fenceWait(gl);
  return performance.now() - t0;
}

/** Chunk cost by wall clock, with the fixed fence latency removed: (T(16) - T(4)) / 12. */
async function chunkMsGL(gl, busy) {
  const a = [], b = [];
  for (let i = 0; i < 3; i++) { a.push(await timeChunks(gl, busy, 4)); b.push(await timeChunks(gl, busy, 16)); }
  return Math.max(1e-3, (median(b) - median(a)) / 12);
}

/** @param {WebGL2RenderingContext} gl @param {{targetMs?: number, chunks?: number}} [o] */
export async function chunkedVsBatchedGL(gl, o = {}) {
  const target = o.targetMs ?? 2, K = o.chunks ?? 24;
  const busy = makeBusy(gl);
  let iters = 16, ms = 0;
  for (let round = 0; round < 12; round++) {
    busy.setIters(iters);
    ms = await chunkMsGL(gl, busy);
    if (ms > 0.7 * target && ms < 1.4 * target) break;
    const scale = ms > 0.02 ? target / ms : 8;
    iters = Math.max(1, Math.min(1 << 16, Math.round(iters * Math.min(8, Math.max(0.125, scale)))));
  }
  /** @param {boolean} waitEach */
  const run = async (waitEach) => {
    await fenceWait(gl);
    const t0 = performance.now();
    for (let i = 0; i < K; i++) { busy.draw(); if (waitEach) await fenceWait(gl); else gl.flush(); }
    await fenceWait(gl);
    return performance.now() - t0;
  };
  const we = [], ne = [];
  for (let rep = 0; rep < 3; rep++) { we.push(await run(true)); ne.push(await run(false)); }
  busy.destroy();
  const w = { waitEach: median(we), noWait: median(ne) };
  return {
    chunks: K, rays: CHUNK * CHUNK, iters, chunkMs: ms, timedBy: 'wall clock (fences)', wallMs: w,
    waitCostPerChunkMs: (w.waitEach - w.noWait) / K, waitedSlowdown: w.waitEach / w.noWait,
  };
}

/**
 * Frame loops. 'fixed': N chunks per frame. 'fence': the WebGL2 budget mode without timer queries. Each frame ends
 * with a fence; at the start of a frame the signalled fences are retired. With 2 or more frames still in flight, or a
 * frame interval over 20 ms, the chunk count drops by 20%; with at most 1 in flight and intervals under 18 ms for 4
 * frames, it grows by 1. When EXT_disjoint_timer_query_webgl2 exists, the GPU time per frame is measured too.
 * @param {WebGL2RenderingContext} gl @param {any} timer
 * @param {{iters: number, chunkMs: number, durationMs?: number, settings?: ({mode:'fixed', chunks:number}|{mode:'fence'})[]}} o
 */
export async function frameLoopGL(gl, timer, o) {
  const busy = makeBusy(gl);
  busy.setIters(o.iters);
  const disp = program(gl, DISPLAY_FS);
  const uRec = gl.getUniformLocation(disp, 'uRec'), uSize = gl.getUniformLocation(disp, 'uSize');
  const canvas = /** @type {HTMLCanvasElement} */ (gl.canvas);
  const settings = o.settings ?? [{ mode: 'fixed', chunks: 0 }, { mode: 'fixed', chunks: 2 }, { mode: 'fixed', chunks: 8 }, { mode: 'fence' }];
  const results = [];
  for (const s of settings) {
    /** @type {number[]} */ const intervals = [], cpu = [], gpuFrame = [], lags = [];
    let chunks = s.mode === 'fixed' ? s.chunks : 1, total = 0, calm = 0;
    /** @type {WebGLSync[]} */ const inflight = [];
    /** @type {WebGLQuery[]} */ const queries = [];
    await fenceWait(gl);
    await new Promise((resolve) => {
      const t0 = performance.now();
      let prev = NaN;
      const frame = (/** @type {number} */ now) => {
        const dt = now - prev;
        if (!Number.isNaN(prev)) intervals.push(dt);
        prev = now;
        while (inflight.length && gl.getSyncParameter(inflight[0], gl.SYNC_STATUS) === gl.SIGNALED) gl.deleteSync(/** @type {WebGLSync} */ (inflight.shift()));
        while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = /** @type {WebGLQuery} */ (queries.shift());
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuFrame.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        }
        lags.push(inflight.length);
        if (s.mode === 'fence' && intervals.length) {
          if (inflight.length >= 2 || dt > 20) { chunks = Math.max(1, Math.floor(chunks * 0.8)); calm = 0; }
          else if (inflight.length <= 1 && dt < 18 && ++calm >= 4) { chunks = Math.min(120, chunks + 1); calm = 0; }
        }
        const c0 = performance.now();
        let q = null;
        if (timer && queries.length < 8) { q = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, q); }
        for (let i = 0; i < chunks; i++) busy.draw();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(disp);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, busy.t.tex[0]);
        gl.uniform1i(uRec, 0);
        gl.uniform2f(uSize, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(q); }
        inflight.push(/** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)));
        gl.flush();
        cpu.push(performance.now() - c0);
        total += chunks;
        if (now - t0 < (o.durationMs ?? 2500)) requestAnimationFrame(frame); else resolve(null);
      };
      requestAnimationFrame(frame);
    });
    await fenceWait(gl);
    inflight.forEach((x) => gl.deleteSync(x));
    queries.forEach((x) => gl.deleteQuery(x));
    const iv = summarize(intervals.slice(5));
    const secs = intervals.reduce((a, b) => a + b, 0) / 1000;
    results.push({
      setting: s, frames: intervals.length, fps: 1000 / iv.median, frameMs: iv,
      gpuFrameMs: gpuFrame.length ? summarize(gpuFrame.slice(5)) : null,
      estGpuFrameMs: (total / Math.max(1, intervals.length)) * o.chunkMs,
      framesInFlight: summarize(lags),
      cpuSubmitMs: summarize(cpu), chunksPerSecond: total / secs, finalChunks: chunks,
    });
  }
  busy.destroy();
  gl.deleteProgram(disp);
  return results;
}

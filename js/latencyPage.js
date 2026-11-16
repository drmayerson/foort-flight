// @ts-check
// latency.html (milestone G0): hello compute plus the CPU-wait and frame-loop measurements, with WebGPU
// (js/gpu/latency.js) and with WebGL2 (js/gl/latencyGL.js). The WebGL2 part runs also when WebGPU is missing.
// `?auto=1` runs at once (for the e2e test); `?quick=1` shortens the frame loops.
import { createGpu, gpuFailed, noWebGPUMessage } from './gpu/device.js';
import { helloCompute, waitLatency, chunkedVsBatched, frameLoop } from './gpu/latency.js';
import { roundDeep } from './gpu/timing.js';
import { openGL, helloGL, waitLatencyGL, chunkedVsBatchedGL, frameLoopGL } from './gl/latencyGL.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const q = new URLSearchParams(location.search);
const f = (/** @type {number} */ x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/** @param {string} s */
const status = (s) => { $('status').textContent = s; };

/** @param {any} r */
function table(r) {
  const rows = [];
  const tr = (/** @type {string} */ a, /** @type {string} */ b, cls = '') => rows.push(`<tr><th>${a}</th><td class="${cls}">${b}</td></tr>`);
  tr('<b>WebGPU</b>', r.webgpuError ? 'not available' : '', r.webgpuError ? 'bad' : '');
  if (r.gpu) tr('GPU', r.gpu + (r.featureLevel === 'compatibility' ? ' (WebGPU compatibility mode)' : ''));
  if (r.hello) tr('Hello compute', r.hello.ok ? `correct (${r.hello.n} values)` : `${r.hello.bad} wrong values, first at ${r.hello.firstBad}`, r.hello.ok ? 'ok' : 'bad');
  if (r.wait) {
    tr('CPU wait per submission', `onSubmittedWorkDone: median ${f(r.wait.onSubmittedWorkDone.median, 2)} ms (p90 ${f(r.wait.onSubmittedWorkDone.p90, 2)});
      16-byte read-back: median ${f(r.wait.mapAsync16B.median, 2)} ms`, r.wait.onSubmittedWorkDone.median < 5 ? 'ok' : 'bad');
  }
  if (r.chunks) {
    const c = r.chunks;
    tr('Chunk', `${c.chunkGpuMs.toFixed(2)} ms GPU each (${c.timedBy}), ${c.chunks} chunks`);
    tr('Waiting per chunk', `${f(c.wallMs.waitEach)} ms total vs ${f(c.wallMs.submitEach)} ms without waiting (one submission: ${f(c.wallMs.oneSubmit)} ms):
      each wait costs ${f(c.waitCostPerChunkMs, 2)} ms, ${f(c.waitedSlowdown, 2)}× slower`, c.waitedSlowdown < 1.5 ? 'ok' : 'bad');
  }
  for (const fl of r.frames ?? []) {
    const s = fl.setting;
    const name = s.mode === 'fixed' ? `Frame loop, ${s.chunks} chunks/frame` : `Frame loop, GPU budget ${s.budgetMs} ms`;
    const gpu = fl.gpuFrameMs ? `, GPU ${f(fl.gpuFrameMs.median)} ms/frame` : '';
    tr(name, `${f(fl.fps)} fps (frame p90 ${f(fl.frameMs.p90)} ms)${gpu}, ${f(fl.chunksPerSecond, 0)} chunks/s${s.mode === 'budget' ? `, settled at ${fl.finalChunks} chunks` : ''}`,
      fl.fps > 50 ? 'ok' : '');
  }
  if (r.framesError) tr('Frame loops', `failed: ${r.framesError}`, 'bad');
  const g = r.webgl2;
  if (g) {
    tr('<b>WebGL2</b>', g.info?.available ? '' : 'not available', g.info?.available ? '' : 'bad');
    if (g.info?.available) tr('GPU', `${g.info.renderer}; float targets ${g.info.colorBufferFloat ? 'yes' : 'NO'}, ${g.info.maxDrawBuffers} draw buffers, timer queries ${g.info.timerQueries ? 'yes' : 'no'}`, g.info.ready ? '' : 'bad');
    if (g.hello) tr('Hello (fragment shader)', g.hello.ok ? `correct (${g.hello.n} values)` : `${g.hello.bad} wrong values`, g.hello.ok ? 'ok' : 'bad');
    if (g.wait) tr('CPU wait per submission', `fence, polled: median ${f(g.wait.fencePolled.median, 2)} ms (p90 ${f(g.wait.fencePolled.p90, 2)}); 1-pixel readPixels: median ${f(g.wait.readPixels1px.median, 2)} ms`, g.wait.fencePolled.median < 5 ? 'ok' : 'bad');
    if (g.chunks) {
      const c = g.chunks;
      tr('Chunk', `${f(c.chunkMs, 2)} ms each (${c.timedBy}), ${c.iters} iterations, ${c.chunks} chunks`);
      tr('Waiting per chunk', `${f(c.wallMs.waitEach)} ms total vs ${f(c.wallMs.noWait)} ms without waiting: each wait costs ${f(c.waitCostPerChunkMs, 2)} ms, ${f(c.waitedSlowdown, 2)}× slower`, c.waitedSlowdown < 1.5 ? 'ok' : 'bad');
    }
    for (const fl of g.frames ?? []) {
      const s = fl.setting;
      const name = s.mode === 'fixed' ? `Frame loop, ${s.chunks} chunks/frame` : 'Frame loop, budget from fences';
      const gpu = fl.gpuFrameMs ? `GPU ${f(fl.gpuFrameMs.median)} ms/frame (timer)` : `GPU ≈ ${f(fl.estGpuFrameMs)} ms/frame (estimated)`;
      tr(name, `${f(fl.fps)} fps (frame p90 ${f(fl.frameMs.p90)} ms), ${gpu}, ${f(fl.chunksPerSecond, 0)} chunks/s, ${f(fl.framesInFlight.median, 0)} frames in flight${s.mode === 'fence' ? `, settled at ${fl.finalChunks} chunks` : ''}`, fl.fps > 50 ? 'ok' : '');
    }
    if (g.error) tr('WebGL2 error', g.error, 'bad');
  }
  if (r.error) tr('Error', r.error, 'bad');
  $('results').innerHTML = rows.join('');
}

/** The WebGL2 measurements, into r.webgl2. @param {any} r */
async function runGL(r) {
  /** @type {any} */
  const w = (r.webgl2 = {});
  try {
    const { gl, timer, info } = openGL(/** @type {HTMLCanvasElement} */ ($('glcanvas')));
    w.info = info;
    if (!gl) return r;
    if (!info.ready) throw new Error('this GPU lacks float render targets or 6 draw buffers');
    status('WebGL2: hello…');
    w.hello = helloGL(gl);
    table(r);
    status('WebGL2: measuring the wait per submission…');
    w.wait = await waitLatencyGL(gl);
    table(r);
    status('WebGL2: chunks waited vs not waited…');
    w.chunks = await chunkedVsBatchedGL(gl);
    table(r);
    status('WebGL2: frame loops…');
    w.frames = await frameLoopGL(gl, timer, { iters: w.chunks.iters, chunkMs: w.chunks.chunkMs, durationMs: q.has('quick') ? 800 : 2500 });
    if (gl.isContextLost()) w.error = 'WebGL context lost';
  } catch (e) {
    w.error = String(e);
  }
  status(r.webgpuError && w.error ? 'failed' : 'done');
  return r;
}

async function run() {
  const btn = /** @type {HTMLButtonElement} */ ($('run'));
  btn.disabled = true;
  /** @type {any} */
  const r = { page: 'foort-flight latency', date: new Date().toISOString(), userAgent: navigator.userAgent };
  try {
    status('opening WebGPU…');
    const g = await createGpu();
    if (gpuFailed(g)) {
      $('nogpu').innerHTML = `<div class="card">${noWebGPUMessage(g)}</div>`;
      r.attempts = g.attempts;
      r.webgpuError = g.reason;
    } else await runGPU(r, g);
  } catch (e) {
    r.webgpuError = String(e);
  }
  try {
    await runGL(r);
  } finally {
    btn.disabled = false;
  }
  return r;
}

/** The WebGPU measurements. @param {any} r @param {import('./gpu/device.js').GpuContext} g */
async function runGPU(r, g) {
  {
    const { device } = g;
    let lost = '';
    device.lost.then((e) => { lost = e.message; });
    const ts = g.features.has('timestamp-query');
    r.gpu = Object.values(g.info).join(' / ') || 'hidden by the browser';
    r.featureLevel = g.featureLevel;
    r.attempts = g.attempts;
    r.timestampQuery = ts;
    status('hello compute…');
    r.hello = await helloCompute(device);
    table(r);
    status('measuring the wait per submission…');
    r.wait = await waitLatency(device);
    table(r);
    status('chunks waited vs not waited…');
    r.chunks = await chunkedVsBatched(device, { timestamps: ts });
    table(r);
    status('frame loops…');
    try {
      r.frames = await frameLoop(device, /** @type {HTMLCanvasElement} */ ($('canvas')), {
        timestamps: ts, iters: r.chunks.iters, durationMs: q.has('quick') ? 800 : 2500,
      });
    } catch (e) {
      // e.g. compatibility mode without storage buffers in fragment shaders: keep the other results
      r.framesError = String(e);
    }
    if (lost) r.webgpuError = `device lost: ${lost}`;
    device.destroy();
  }
}

$('run').onclick = async () => {
  const r = roundDeep(await run());
  /** @type {any} */ (window).__latency = r;
  table(r);
  const text = JSON.stringify(r, null, 1);
  $('json').textContent = text;
  const copy = /** @type {HTMLButtonElement} */ ($('copy'));
  copy.disabled = false;
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(text); $('copied').textContent = 'copied'; } catch { $('copied').textContent = 'select the text below and copy it'; }
  };
  document.body.dataset.done = r.webgpuError && (r.webgl2?.error || !r.webgl2?.info?.available) ? 'error' : '1';
};

if (q.has('auto')) $('run').click();

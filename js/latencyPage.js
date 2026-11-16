// @ts-check
// latency.html (milestone G0): hello compute plus the CPU-wait and frame-loop measurements of js/gpu/latency.js.
// `?auto=1` runs at once (for the e2e test); `?quick=1` shortens the frame loops.
import { createGpu, gpuFailed, noWebGPUMessage } from './gpu/device.js';
import { helloCompute, waitLatency, chunkedVsBatched, frameLoop } from './gpu/latency.js';
import { roundDeep } from './gpu/timing.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const q = new URLSearchParams(location.search);
const f = (/** @type {number} */ x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/** @param {string} s */
const status = (s) => { $('status').textContent = s; };

/** @param {any} r */
function table(r) {
  const rows = [];
  const tr = (/** @type {string} */ a, /** @type {string} */ b, cls = '') => rows.push(`<tr><th>${a}</th><td class="${cls}">${b}</td></tr>`);
  tr('GPU', r.gpu);
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
  if (r.error) tr('Error', r.error, 'bad');
  $('results').innerHTML = rows.join('');
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
      $('results').outerHTML = `<div class="card">${noWebGPUMessage(g)}</div>`;
      r.error = g.reason;
      return r;
    }
    const { device } = g;
    let lost = '';
    device.lost.then((e) => { lost = e.message; });
    const ts = g.features.has('timestamp-query');
    r.gpu = Object.values(g.info).join(' / ') || 'hidden by the browser';
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
    r.frames = await frameLoop(device, /** @type {HTMLCanvasElement} */ ($('canvas')), {
      timestamps: ts, iters: r.chunks.iters, durationMs: q.has('quick') ? 800 : 2500,
    });
    if (lost) r.error = `device lost: ${lost}`;
    device.destroy();
    status('done');
  } catch (e) {
    r.error = String(e);
    status('failed');
  } finally {
    btn.disabled = false;
  }
  return r;
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
  document.body.dataset.done = r.error ? 'error' : '1';
};

if (q.has('auto')) $('run').click();

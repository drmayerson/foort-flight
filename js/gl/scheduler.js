// @ts-check
// Per-frame trace scheduler (plan v1.1 Section 3 and 5.4; G0b lessons in PROGRESS.md).
//
// Every animation frame the caller runs `frame(now)` (encodes this frame's trace chunks), draws its display pass,
// then `endFrame()` (one fence, flush). Nothing ever waits on the GPU.
//
// Budget: a number of rays per frame, R.
//   - with timer queries (Chrome on the laptop): the measured trace rate (rays per GPU ms, per program; the slower of its average and the
//     latest frame) sets R to fill `budgetFraction` (0.5) of the device's refresh interval;
//   - without (Firefox, the phone): additive-increase / multiplicative-decrease on two signals: the frames still in
//     flight (>= 2: the GPU is behind) and the frame interval relative to the device's own refresh interval (measured,
//     since displays run at 24-120 Hz; the G0b phone ran at 24 Hz with an idle GPU).
// Chunks: rectangles of one trace, bands of 16 rows taken centre-out, cut to the budget, never larger than
// `maxChunkRays` (the OS GPU watchdog). A job's `done` resolves when the fence after its last chunk has signalled.

import { percentile } from '../gpu/timing.js';

const BAND = 16;

/**
 * @typedef {import('./tracer.js').Tracer} Tracer
 * @typedef {import('./tracer.js').RecordTarget} RecordTarget
 * @typedef {import('./tracer.js').Rect} Rect
 */

/** Bands of a w x h image, centre-out. @param {number} h */
export function bandsCentreOut(h) {
  const n = Math.ceil(h / BAND), mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b).map((i) => i * BAND);
}

export class TraceJob {
  /**
   * @param {Tracer} tracer @param {string} program @param {import('./tracer.js').Uniforms} uniforms @param {RecordTarget} target
   * @param {Rect} [region] the part of the target to trace (default all of it; cubemap faces, compact rows)
   * @param {{img?: number[], textures?: Record<string, WebGLTexture|null>}} [extra] passed to encodeChunk
   */
  constructor(tracer, program, uniforms, target, region, extra) {
    this.tracer = tracer; this.program = program; this.uniforms = uniforms; this.target = target;
    this.region = region ?? { x: 0, y: 0, w: target.w, h: target.h };
    this.extra = extra;
    this.bands = bandsCentreOut(this.region.h);
    this.band = 0; this.x = 0;
    this.raysDone = 0; this.raysTotal = this.region.w * this.region.h;
    this.started = NaN; this.frames = 0;
    /** @type {(v: {wallMs: number, frames: number, rays: number, cancelled?: boolean}) => void} */
    this.resolve = () => {};
    /** @type {Promise<{wallMs: number, frames: number, rays: number, cancelled?: boolean}>} */
    this.done = new Promise((res) => { this.resolve = res; });
    this.cancelled = false;
  }

  get encoded() { return this.band >= this.bands.length; }

  /** the next chunk of at most `rays` rays (at least one band segment of 16 pixels) @param {number} rays @returns {Rect|null} */
  next(rays) {
    if (this.encoded) return null;
    const { w, h } = this.region, y = this.bands[this.band], bh = Math.min(BAND, h - y);
    const width = Math.max(BAND, Math.min(w - this.x, Math.floor(rays / bh)));
    const rect = { x: this.x, y, w: Math.min(width, w - this.x), h: bh };
    this.x += rect.w;
    if (this.x >= w) { this.x = 0; this.band++; }
    this.raysDone += rect.w * rect.h;
    return { x: rect.x + this.region.x, y: rect.y + this.region.y, w: rect.w, h: rect.h };
  }
}

export class FrameScheduler {
  /**
   * @param {Tracer} tracer
   * @param {{budgetFraction?: number, maxChunkRays?: number, initialRays?: number, minRays?: number}} [o]
   */
  constructor(tracer, o = {}) {
    this.tracer = tracer;
    this.gl = tracer.gl;
    this.timer = tracer.timerExt;
    this.budgetFraction = o.budgetFraction ?? 0.5;
    this.maxChunkRays = o.maxChunkRays ?? 65536;
    this.minRays = o.minRays ?? 256;
    this.R = o.initialRays ?? 4096;
    /** @type {TraceJob[]} */
    this.queue = [];
    /** frames in flight: fence, rays traced, jobs finished in that frame @type {{sync: WebGLSync, rays: number, finished: TraceJob[]}[]} */
    this.inflight = [];
    /** @type {{q: WebGLQuery, rays: number, program: string}[]} */
    this.queries = [];
    /** @type {number[]} */
    this.intervals = [];
    this.prev = NaN;
    this.calm = 0;
    /** rays per GPU ms (EMA) per tracer program, from timer queries: a fuzzball ray costs far more than a Kerr ray */
    this.rates = /** @type {Map<string, {ema: number, last: number}>} */ (new Map());
    /** GPU ms of the last timed frame, and of its refresh interval share */
    this.lastGpuMs = NaN;
    this.cur = { rays: 0, finished: /** @type {TraceJob[]} */ ([]), q: /** @type {WebGLQuery|null} */ (null), program: '' };
    this.lastProgram = '';
    this.log = { frames: 0, rays: 0, inflight: /** @type {number[]} */ ([]), R: /** @type {number[]} */ ([]) };
    /** recent frames for diagnostics: interval, budget, rays encoded, in flight, last GPU ms @type {number[][]} */
    this.trace = [];
  }

  /**
   * queue a trace @param {string} program @param {import('./tracer.js').Uniforms} uniforms @param {RecordTarget} target
   * @param {Rect} [region] @param {{img?: number[], textures?: Record<string, WebGLTexture|null>}} [extra]
   */
  submit(program, uniforms, target, region = undefined, extra = undefined) {
    const job = new TraceJob(this.tracer, program, uniforms, target, region, extra);
    this.queue.push(job);
    return job;
  }

  /** drop queued work (records already traced stay) */
  cancelAll() {
    for (const j of this.queue) { j.cancelled = true; j.resolve({ wallMs: NaN, frames: j.frames, rays: j.raysDone, cancelled: true }); }
    this.queue = [];
  }

  /** the device's refresh interval: a low percentile of recent frame intervals */
  /** rays per GPU ms of the program at the head of the queue (NaN until measured) */
  get rate() {
    // pessimistic: the slower of the average and the latest frame (costs change across an image, centre-out)
    const e = this.rates.get(this.queue[0]?.program ?? '');
    return e ? Math.min(e.ema, e.last) : NaN;
  }

  get refreshMs() { return this.intervals.length >= 8 ? percentile(this.intervals, 0.2) : 16.7; }

  /** retire signalled fences and timer queries */
  poll() {
    const gl = this.gl;
    while (this.inflight.length) {
      const f = this.inflight[0];
      const st = gl.clientWaitSync(f.sync, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
      gl.deleteSync(f.sync);
      this.inflight.shift();
      const t = performance.now();
      for (const j of f.finished) j.resolve({ wallMs: t - j.started, frames: j.frames, rays: j.raysTotal });
    }
    if (this.timer) {
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      while (this.queries.length && gl.getQueryParameter(this.queries[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const e = /** @type {{q: WebGLQuery, rays: number, program: string}} */ (this.queries.shift());
        const ms = gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(e.q);
        if (!disjoint && ms > 0.05 && e.rays > 0) {
          this.lastGpuMs = ms;
          const r = e.rays / ms, old = this.rates.get(e.program);
          this.rates.set(e.program, { ema: old === undefined ? r : 0.7 * old.ema + 0.3 * r, last: r });
        }
      }
    }
  }

  /** choose this frame's ray budget @param {number} dt */
  adapt(dt) {
    const refresh = this.refreshMs, n = this.inflight.length;
    const rate = this.rate;
    if (Number.isFinite(rate)) {
      // timer queries: fill a fraction of the refresh interval; back off when frames pile up anyway, or when the last
      // timed frame overran the interval (ray costs vary across an image: the fuzzball's centre is the slowest)
      this.R = rate * this.budgetFraction * refresh * (n >= 2 ? 0.5 : 1) * (this.lastGpuMs > refresh ? 0.5 : 1);
    } else if (this.timer && Number.isFinite(this.lastGpuMs) && this.lastGpuMs > refresh) {
      this.R *= 0.5; this.lastGpuMs = NaN;
    } else if (n >= 2 || dt > 1.5 * refresh) {
      this.R *= 0.7; this.calm = 0;
    } else if (n <= 1 && dt < 1.25 * refresh && ++this.calm >= 3) {
      this.R *= 1.15; this.calm = 0;
    }
    this.R = Math.min(Math.max(this.R, this.minRays), 16 * this.maxChunkRays);
  }

  /**
   * Encode this frame's trace chunks (call once per animation frame, before the display pass).
   * @param {number} now requestAnimationFrame time
   */
  frame(now) {
    const dt = now - this.prev;
    if (Number.isFinite(dt) && dt > 0) { this.intervals.push(dt); if (this.intervals.length > 120) this.intervals.shift(); }
    this.prev = now;
    this.poll();
    const busy = this.queue.length > 0;
    if (busy && Number.isFinite(dt)) this.adapt(dt);
    this.cur = { rays: 0, finished: [], q: null, program: this.queue[0]?.program ?? '' };
    if (!busy) return 0;
    // a program not measured yet starts small and grows (timer results arrive a few frames late)
    if (this.timer && !this.rates.has(this.cur.program) && this.cur.program !== this.lastProgram) this.R = Math.min(this.R, 1024);
    this.lastProgram = this.cur.program;
    const gl = this.gl;
    if (this.timer && this.queries.length < 6) { this.cur.q = gl.createQuery(); gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.cur.q); }
    let budget = this.R;
    while (budget >= this.minRays / 2 && this.queue.length) {
      const job = this.queue[0];
      if (Number.isNaN(job.started)) job.started = performance.now();
      const rect = job.next(Math.min(budget, this.maxChunkRays));
      if (rect) {
        this.tracer.encodeChunk(job.program, job.uniforms, job.target, rect, job.extra);
        budget -= rect.w * rect.h;
        this.cur.rays += rect.w * rect.h;
      }
      if (job.encoded) { this.queue.shift(); this.cur.finished.push(job); }
    }
    for (const j of new Set([...this.queue.slice(0, 1), ...this.cur.finished])) j.frames++;
    if (this.cur.q) { gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queries.push({ q: this.cur.q, rays: this.cur.rays, program: this.cur.program }); }
    this.trace.push([+dt.toFixed(1), Math.round(this.R), this.cur.rays, this.inflight.length, +(this.lastGpuMs || 0).toFixed(1)]);
    if (this.trace.length > 300) this.trace.shift();
    this.log.frames++; this.log.rays += this.cur.rays;
    this.log.inflight.push(this.inflight.length); this.log.R.push(this.R);
    if (this.log.R.length > 600) { this.log.R.shift(); this.log.inflight.shift(); }
    return this.cur.rays;
  }

  /** after the display pass: one fence for the frame */
  endFrame() {
    const gl = this.gl;
    if (this.cur.rays > 0 || this.cur.finished.length) {
      this.inflight.push({ sync: /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)), rays: this.cur.rays, finished: this.cur.finished });
    }
    gl.flush();
  }

  stats() {
    return { R: this.R, rate: this.rate, refreshMs: this.refreshMs, inflight: this.inflight.length, queued: this.queue.length, frames: this.log.frames, rays: this.log.rays };
  }
}

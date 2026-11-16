// @ts-check
// GPU timing without CPU stalls (plan Section 3, "Firefox WebGPU latency"): timestamp queries are written into a
// ring of query sets and resolved into buffers that are mapped asynchronously; nothing here awaits inside a frame.
// Also small statistics helpers (pure; unit-tested in node).

/** @param {number[]} xs @param {number} p in [0, 1] */
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, p * (s.length - 1)));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** @param {number[]} xs */
export const median = (xs) => percentile(xs, 0.5);

/** @param {number[]} xs */
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Summary of a sample of times (ms).
 * @param {number[]} xs
 * @returns {{n:number, median:number, p10:number, p90:number, min:number, max:number, mean:number}}
 */
export function summarize(xs) {
  return {
    n: xs.length, median: median(xs), p10: percentile(xs, 0.1), p90: percentile(xs, 0.9),
    min: xs.length ? Math.min(...xs) : NaN, max: xs.length ? Math.max(...xs) : NaN, mean: mean(xs),
  };
}

/** Round every number of an object to `digits` significant digits (for compact JSON reports). @param {any} v @param {number} [digits] @returns {any} */
export function roundDeep(v, digits = 4) {
  if (typeof v === 'number') return Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(digits)) : v;
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, digits));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x, digits)]));
  return v;
}

/**
 * Timestamp-query timer. `begin(label)` returns `timestampWrites` for a pass; `endFrame(encoder)` appends the resolve
 * to the frame's encoder; after submission `collect()` starts an asynchronous map. Results arrive through `onResult`
 * one or more frames later. Without the 'timestamp-query' feature every method is a no-op.
 */
export class GpuTimer {
  /**
   * @param {GPUDevice} device
   * @param {boolean} enabled           the device has 'timestamp-query'
   * @param {(r: {label: string, ms: number}[]) => void} onResult
   * @param {{maxPasses?: number, ring?: number}} [opts]
   */
  constructor(device, enabled, onResult, opts = {}) {
    this.device = device;
    this.enabled = enabled;
    this.onResult = onResult;
    this.maxPasses = opts.maxPasses ?? 64;
    /** @type {{qs: GPUQuerySet, resolve: GPUBuffer, read: GPUBuffer, busy: boolean, labels: string[]}[]} */
    this.slots = [];
    this.cur = -1;
    this.dropped = 0;
    if (!enabled) return;
    const n = opts.ring ?? 4, bytes = 16 * this.maxPasses;
    for (let i = 0; i < n; i++) {
      this.slots.push({
        qs: device.createQuerySet({ type: 'timestamp', count: 2 * this.maxPasses }),
        resolve: device.createBuffer({ size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        busy: false, labels: [],
      });
    }
  }

  /** Start a frame: picks a free slot, or disables timing for this frame when all are still mapping. */
  beginFrame() {
    if (!this.enabled) return;
    this.cur = this.slots.findIndex((s) => !s.busy);
    if (this.cur < 0) this.dropped++;
    else this.slots[this.cur].labels = [];
  }

  /**
   * @param {string} label
   * @returns {GPUComputePassTimestampWrites | undefined} pass this as the pass descriptor's `timestampWrites`
   */
  pass(label) {
    if (!this.enabled || this.cur < 0) return undefined;
    const s = this.slots[this.cur];
    if (s.labels.length >= this.maxPasses) return undefined;
    const k = s.labels.length;
    s.labels.push(label);
    return { querySet: s.qs, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 };
  }

  /** Append the resolve and copy for the frame's queries. @param {GPUCommandEncoder} enc */
  endFrame(enc) {
    if (!this.enabled || this.cur < 0) return;
    const s = this.slots[this.cur];
    if (!s.labels.length) return;
    enc.resolveQuerySet(s.qs, 0, 2 * s.labels.length, s.resolve, 0);
    enc.copyBufferToBuffer(s.resolve, 0, s.read, 0, 16 * s.labels.length);
  }

  /** Call after `queue.submit`: maps the frame's results asynchronously (never awaited by the caller). */
  collect() {
    if (!this.enabled || this.cur < 0) return;
    const s = this.slots[this.cur];
    this.cur = -1;
    if (!s.labels.length) return;
    s.busy = true;
    const labels = s.labels.slice();
    s.read.mapAsync(GPUMapMode.READ, 0, 16 * labels.length).then(() => {
      const ts = new BigUint64Array(s.read.getMappedRange(0, 16 * labels.length).slice(0));
      s.read.unmap();
      s.busy = false;
      const out = labels.map((label, k) => ({ label, ms: Number(ts[2 * k + 1] - ts[2 * k]) / 1e6 }));
      this.onResult(out);
    }, () => { s.busy = false; });
  }

  destroy() {
    for (const s of this.slots) { s.qs.destroy(); s.resolve.destroy(); s.read.destroy(); }
    this.slots = [];
    this.enabled = false;
  }
}

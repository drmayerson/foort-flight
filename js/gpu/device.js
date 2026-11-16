// @ts-check
// WebGPU adapter and device creation (plan Section 3). There is no WebGL2 fallback: when WebGPU is missing or the
// adapter cannot be created, callers show `noWebGPUMessage` with a link to the FOORT-GPU viewer.

/** The limits FOORT Flight asks to raise to the adapter's maximum (plan Section 3, "Limits"). */
export const RAISED_LIMITS = /** @type {const} */ ([
  'maxStorageBufferBindingSize',
  'maxBufferSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupStorageSize',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxColorAttachments',
]);

/** Optional features used when present. */
export const OPTIONAL_FEATURES = /** @type {const} */ (['timestamp-query', 'shader-f16', 'float32-filterable']);

export const FOORT_GPU_URL = 'https://drmayerson.github.io/foort-gpu/';

/**
 * @typedef {Object} GpuContext
 * @property {true} ok
 * @property {GPUAdapter} adapter
 * @property {GPUDevice} device
 * @property {Set<string>} features      the optional features that were enabled
 * @property {Record<string, string>} info
 * @property {boolean} isFallbackAdapter
 * @property {'core'|'compatibility'} featureLevel
 * @property {string[]} attempts      the adapter requests tried and their outcome
 * @property {string[]} raisedLimitsFailed limits that could not be raised (requestDevice was retried without them)
 */

/**
 * @typedef {Object} GpuFailure
 * @property {false} ok
 * @property {null} device
 * @property {'no-api'|'no-adapter'|'adapter-error'|'device-error'} kind
 * @property {string[]} [attempts] the adapter requests tried and their outcome
 * @property {string} reason
 */

/** Type guard: did `createGpu` fail? @param {GpuContext|GpuFailure} g @returns {g is GpuFailure} */
export const gpuFailed = (g) => !g.ok;

/** @param {GPUAdapter} adapter @returns {Record<string, string>} */
export function adapterInfo(adapter) {
  const ai = /** @type {any} */ (adapter).info ?? {};
  /** @type {Record<string, string>} */
  const info = {};
  for (const k of ['vendor', 'architecture', 'device', 'description']) if (ai[k]) info[k] = String(ai[k]);
  return info;
}

/**
 * Create the WebGPU device with raised limits and the optional features this adapter has.
 * @param {{powerPreference?: GPUPowerPreference, features?: readonly string[]}} [opts]
 * @returns {Promise<GpuContext | GpuFailure>}
 */
export async function createGpu(opts = {}) {
  const gpu = /** @type {GPU|undefined} */ (/** @type {any} */ (globalThis.navigator)?.gpu);
  if (!gpu) return { ok: false, device: null, kind: 'no-api', reason: 'This browser does not offer WebGPU (navigator.gpu is missing).' };
  // Adapter attempts, in order: the plan's high-performance core adapter; any core adapter; WebGPU compatibility mode
  // (Chrome can offer it on OpenGL ES where core WebGPU is unavailable, e.g. on some Android GPUs).
  /** @type {{label: string, options: any}[]} */
  const tries = [
    { label: 'core, high-performance', options: { powerPreference: opts.powerPreference ?? 'high-performance' } },
    { label: 'core, default', options: {} },
    { label: 'compatibility', options: { featureLevel: 'compatibility' } },
  ];
  /** @type {string[]} */
  const attempts = [];
  /** @type {GPUAdapter|null} */
  let adapter = null;
  let featureLevel = 'core';
  for (const t of tries) {
    try {
      adapter = await gpu.requestAdapter(t.options);
      attempts.push(`${t.label}: ${adapter ? 'adapter' : 'none'}`);
    } catch (e) {
      attempts.push(`${t.label}: error ${e}`);
      adapter = null;
    }
    if (adapter) {
      // an adapter that is compatibility-only lacks 'core-features-and-limits' (Chrome)
      const core = adapter.features.has('core-features-and-limits') || t.label !== 'compatibility';
      featureLevel = core ? 'core' : 'compatibility';
      break;
    }
  }
  if (!adapter) return { ok: false, device: null, kind: 'no-adapter', attempts, reason: 'WebGPU is present, but the browser returned no graphics adapter (the GPU may be blocklisted or WebGPU disabled).' };

  const wanted = opts.features ?? OPTIONAL_FEATURES;
  const features = /** @type {GPUFeatureName[]} */ (wanted.filter((f) => adapter.features.has(f)));
  /** @type {Record<string, number>} */
  const requiredLimits = {};
  for (const k of RAISED_LIMITS) {
    const v = /** @type {any} */ (adapter.limits)[k];
    if (typeof v === 'number') requiredLimits[k] = v;
  }
  /** @type {string[]} */
  const raisedLimitsFailed = [];
  /** @type {GPUDevice} */
  let device;
  try {
    device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits });
  } catch (e) {
    // some implementations reject limits they report; fall back to the defaults
    raisedLimitsFailed.push(...Object.keys(requiredLimits));
    try {
      device = await adapter.requestDevice({ requiredFeatures: features });
    } catch (e2) {
      return { ok: false, device: null, kind: 'device-error', attempts, reason: `WebGPU could not create a device: ${e2}` };
    }
  }
  return {
    ok: true, adapter, device, features: new Set(features), info: adapterInfo(adapter),
    isFallbackAdapter: !!(/** @type {any} */ (adapter).isFallbackAdapter ?? /** @type {any} */ (adapter).info?.isFallbackAdapter),
    raisedLimitsFailed, featureLevel: /** @type {'core'|'compatibility'} */ (featureLevel), attempts,
  };
}

/**
 * The explanation shown when WebGPU is unavailable (plan Section 3: a clear page, linking to the FOORT-GPU viewer).
 * @param {GpuFailure} failure @returns {string} HTML
 */
export function noWebGPUMessage(failure) {
  const esc = (/** @type {string} */ s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  return `<h2>FOORT Flight needs WebGPU</h2>
<p class="bad">${esc(failure.reason)}</p>
<p>FOORT Flight ray traces the view in real time with WebGPU compute shaders. It runs in a recent
<b>Chrome</b> or <b>Edge</b> on Windows, macOS and ChromeOS, in Chrome on many Android phones, in Safari 26+, and in
recent Firefox versions on Windows. Updating the browser or its graphics drivers often helps.</p>
<p>Without WebGPU you can still look at black holes and fuzzballs (from a fixed camera) in the
<a href="${FOORT_GPU_URL}">FOORT-GPU viewer</a>, which uses WebGL2.</p>
<p><a href="./caps.html">What does this browser offer?</a></p>`;
}

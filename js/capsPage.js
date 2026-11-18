// @ts-check
// The capability report (caps.html, milestone G0; WebGL2 added 2026-11-18): the WebGL2 context the game uses, and the WebGPU adapter, features, limits, f16 and timestamp support.
import { createGpu, gpuFailed, adapterInfo, RAISED_LIMITS } from './gpu/device.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const esc = (/** @type {any} */ s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

/** @param {string} label @param {boolean|null} ok @param {string} text */
const row = (label, ok, text) =>
  `<tr><th>${esc(label)}</th><td class="${ok === null ? 'muted' : ok ? 'ok' : 'bad'}">${ok === null ? '–' : ok ? '✓' : '✗'}</td><td>${esc(text)}</td></tr>`;

/** All limit names of a GPUSupportedLimits object (they live on the prototype). @param {any} lim */
function limitNames(lim) {
  const names = new Set();
  for (let o = lim; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    for (const k of Object.getOwnPropertyNames(o)) if (typeof lim[k] === 'number') names.add(k);
  return [...names].sort();
}

/** @param {any} lim @param {string[]} names */
const pick = (lim, names) => Object.fromEntries(names.map((k) => [k, lim[k]]));

/** Compile a tiny shader with `enable f16;` and run it once. @param {GPUDevice} device */
async function testF16(device) {
  try {
    const module = device.createShaderModule({ code: 'enable f16;\n@group(0) @binding(0) var<storage, read_write> o: array<f32>;\n@compute @workgroup_size(1) fn main() { let h: f16 = 1.5h; o[0] = f32(h * 2.0h); }' });
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    return errs.length ? `compile error: ${errs[0].message}` : 'compiles';
  } catch (e) { return `error: ${e}`; }
}

/**
 * What the game uses (WebGL2, DECISIONS F12): the graphics card and driver as the browser reports them, the
 * extensions the tracer and display need, and the limits that set the cubemap sizes.
 */
function webgl2Info() {
  const gl = /** @type {WebGL2RenderingContext|null} */ (document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' }));
  if (!gl) return { available: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const ext = (/** @type {string} */ n) => !!gl.getExtension(n);
  const out = {
    available: true,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    colorBufferFloat: ext('EXT_color_buffer_float'), floatLinear: ext('OES_texture_float_linear'), timerQuery: ext('EXT_disjoint_timer_query_webgl2'),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS), maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
    maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    highpFloat: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0,
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}

export async function collectCaps() {
  const nav = /** @type {any} */ (navigator);
  /** @type {any} */
  const report = {
    page: 'foort-flight caps', date: new Date().toISOString(), userAgent: navigator.userAgent,
    userAgentData: nav.userAgentData ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile, brands: nav.userAgentData.brands } : undefined,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, hardwareConcurrency: navigator.hardwareConcurrency,
    webgl2: webgl2Info(),
    webgpu: { available: false },
  };
  const g = await createGpu();
  if (gpuFailed(g)) { report.webgpu = { available: false, kind: g.kind, reason: g.reason, attempts: g.attempts }; return report; }
  const { adapter, device } = g;
  const names = limitNames(adapter.limits);
  // the defaults: a device without required limits, from a second adapter (an adapter may create only one device:
  // Firefox enforces this, so asking the first adapter again returned nothing)
  let defaults = {};
  try {
    const a0 = await nav.gpu.requestAdapter(g.featureLevel === 'compatibility' ? { featureLevel: 'compatibility' } : { powerPreference: 'high-performance' });
    const d0 = await a0.requestDevice();
    defaults = pick(d0.limits, names);
    d0.destroy();
  } catch { /* reported as empty */ }
  report.webgpu = {
    available: true,
    info: adapterInfo(adapter),
    isFallbackAdapter: g.isFallbackAdapter,
    featureLevel: g.featureLevel,
    attempts: g.attempts,
    features: [...adapter.features].map(String).sort(),
    wgslLanguageFeatures: nav.gpu.wgslLanguageFeatures ? [...nav.gpu.wgslLanguageFeatures].sort() : [],
    preferredCanvasFormat: nav.gpu.getPreferredCanvasFormat(),
    enabledFeatures: [...g.features],
    raisedLimitsFailed: g.raisedLimitsFailed,
    limits: { adapter: pick(adapter.limits, names), default: defaults, device: pick(device.limits, names) },
    f16: adapter.features.has('shader-f16') ? await testF16(device) : 'not offered',
    timestampQuery: adapter.features.has('timestamp-query'),
  };
  device.destroy();
  return report;
}

/** @param {number} v */
const fmt = (v) => (v === undefined ? '–' : v >= 1 << 20 ? `${(v / (1 << 20)).toFixed(v % (1 << 20) ? 1 : 0)} MiB` : String(v));

async function main() {
  const r = await collectCaps();
  /** @type {any} */ (window).__caps = r;
  const w = r.webgpu, g = r.webgl2;
  let html = row('WebGL2 (used by the game)', g.available, g.available ? `${g.renderer} (${g.vendor})` : 'not available: the game cannot run here');
  if (g.available) {
    html += row('Float render targets', g.colorBufferFloat, g.colorBufferFloat ? 'EXT_color_buffer_float' : 'missing: the tracer needs it');
    html += row('GPU timer queries', g.timerQuery, g.timerQuery ? 'available' : 'not offered: frame budgets use fences only');
    html += row('Draw buffers', g.maxDrawBuffers >= 8, `${g.maxDrawBuffers} (8 needed to split long fuzzball rays)`);
    html += row('Texture size', g.maxTextureSize >= 4096, `${g.maxTextureSize} (a 512² cubemap needs 1536)`);
  }
  html += row('WebGPU (not used by the game)', w.available, w.available ? Object.values(w.info).join(' / ') || 'adapter info hidden by the browser' : w.reason);
  if (w.attempts) html += row('Adapter requests', w.available ? w.featureLevel === 'core' : false, w.attempts.join('; ') + (w.available && w.featureLevel === 'compatibility' ? ' — compatibility mode only (OpenGL ES level): fewer features' : ''));
  if (w.available) {
    const L = w.limits.device;
    html += row('Fallback (software) adapter', !w.isFallbackAdapter, w.isFallbackAdapter ? 'yes: very slow, for testing only' : 'no');
    html += row('timestamp-query', w.timestampQuery, w.timestampQuery ? 'GPU timing available' : 'not offered: frame budgets fall back to wall-clock time');
    html += row('shader-f16', w.f16 === 'compiles', w.f16);
    html += row('Storage buffer binding', L.maxStorageBufferBindingSize >= 128 << 20, `${fmt(L.maxStorageBufferBindingSize)} (a 256² cubemap of records needs 38 MiB; 384² needs 85 MiB)`);
    html += row('Buffer size', L.maxBufferSize >= 256 << 20, fmt(L.maxBufferSize));
    html += row('Invocations per workgroup', L.maxComputeInvocationsPerWorkgroup >= 256, String(L.maxComputeInvocationsPerWorkgroup));
    html += row('Raised limits', w.raisedLimitsFailed.length === 0, w.raisedLimitsFailed.length ? `refused: ${w.raisedLimitsFailed.join(', ')}` : 'all granted');
    html += row('Canvas format', null, w.preferredCanvasFormat);
  }
  html += row('Browser', null, navigator.userAgent);
  $('summary').innerHTML = html;
  if (w.available) {
    const keys = Object.keys(w.limits.adapter);
    $('limits').innerHTML = '<tr><th>limit</th><th>adapter</th><th>default</th><th>device</th></tr>' +
      keys.map((k) => `<tr${RAISED_LIMITS.includes(/** @type {any} */ (k)) ? ' class="ok"' : ''}><td>${k}</td><td class="num">${fmt(w.limits.adapter[k])}</td><td class="num">${fmt(w.limits.default[k])}</td><td class="num">${fmt(w.limits.device[k])}</td></tr>`).join('');
  }
  const text = JSON.stringify(r, null, 1);
  $('json').textContent = text;
  const btn = /** @type {HTMLButtonElement} */ ($('copy'));
  btn.disabled = false;
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(text); $('copied').textContent = 'copied'; } catch { $('copied').textContent = 'select the text below and copy it'; }
  };
  document.body.dataset.done = '1';
}

main().catch((e) => { $('summary').innerHTML = `<tr><td class="bad">Capability check failed: ${esc(e)}</td></tr>`; document.body.dataset.done = 'error'; });

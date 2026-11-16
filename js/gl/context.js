// @ts-check
// WebGL2 context check (plan v1.1 Section 3): FOORT Flight needs WebGL2 with float render targets
// (EXT_color_buffer_float) and at least 6 draw buffers (the 24-float record). Without them, callers show
// `noWebGL2Message`, which links to the FOORT-GPU viewer.

export const FOORT_GPU_URL = 'https://drmayerson.github.io/foort-gpu/';
export const RECORD_ATTACHMENTS = 6;

/**
 * @typedef {Object} GLCheck
 * @property {boolean} ok
 * @property {string} reason      empty when ok
 * @property {string} renderer
 * @property {number} maxDrawBuffers
 * @property {boolean} timerQueries
 */

/** @param {HTMLCanvasElement} [canvas] @returns {GLCheck} */
export function checkWebGL2(canvas = document.createElement('canvas')) {
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) return { ok: false, reason: 'This browser does not offer WebGL2 (or it is switched off).', renderer: '', maxDrawBuffers: 0, timerQueries: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const cbf = !!gl.getExtension('EXT_color_buffer_float');
  const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const timerQueries = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let reason = '';
  if (!cbf) reason = 'This GPU or browser cannot render to float textures (EXT_color_buffer_float is missing).';
  else if (maxDrawBuffers < RECORD_ATTACHMENTS) reason = `This GPU offers ${maxDrawBuffers} draw buffers; FOORT Flight needs ${RECORD_ATTACHMENTS}.`;
  else if (!hp || hp.precision < 23) reason = 'This GPU has no full 32-bit float precision in fragment shaders.';
  return { ok: !reason, reason, renderer, maxDrawBuffers, timerQueries };
}

/** @param {GLCheck} check @returns {string} HTML */
export function noWebGL2Message(check) {
  const esc = (/** @type {string} */ s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  return `<h2>FOORT Flight cannot run here</h2>
<p class="bad">${esc(check.reason)}</p>
<p>FOORT Flight ray traces the view in real time with WebGL2. It runs in recent versions of Chrome, Edge, Firefox and
Safari, on computers and on most phones. Updating the browser or the graphics drivers often helps.</p>
<p>You can also try the <a href="${FOORT_GPU_URL}">FOORT-GPU viewer</a>, which shows black holes and fuzzballs from a
fixed camera.</p>
<p><a href="./caps.html">What does this browser offer?</a></p>`;
}

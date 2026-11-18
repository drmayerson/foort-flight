// @ts-check
// The game's WebGL2 tracer backend (plan v1.1, G1). It runs FOORT-GPU's GLSL tracer unchanged, loaded from
// vendor/foort-gpu/shaders/glsl/, with the uniforms of the vendored traceConfig.gpuTraceSetup (or the game's general
// camera, js/camera/generalTetrad.js). Unlike FOORT-GPU's backend it never waits: `encodeChunk` only issues a draw;
// the per-frame scheduler (js/gl/scheduler.js) decides how many chunks a frame gets and tracks fences.
//
// Program assembly, the table packing and the record read-back follow FOORT-GPU's js/gpu/backendWebGL2.js
// (setTracer, uploadTables, uploadFluid, readRecords), which is not vendored: it is tied to the viewer's levels, record
// cache and display, and waits on a fence per tile (DECISIONS.md, G1).

import { RECORD_ATTACHMENTS } from './context.js';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
export const TAIL_BINS = 8;
export const RECORD_FLOATS = 24;
export const SHADER_BASE = new URL('../../vendor/foort-gpu/shaders/glsl/', import.meta.url).href;

/** Yield to the event loop without the setTimeout clamp. */
export const yieldNow = () => new Promise((res) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => res(undefined);
  ch.port2.postMessage(0);
});

/**
 * @typedef {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} Uniforms
 * @typedef {{fbo: WebGLFramebuffer, tex: WebGLTexture[], w: number, h: number}} RecordTarget
 * @typedef {{x: number, y: number, w: number, h: number}} Rect
 */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{shaderBase?: string}} [opts]
 */
export async function createTracer(gl, opts = {}) {
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is missing');
  if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < RECORD_ATTACHMENTS) throw new Error(`fewer than ${RECORD_ATTACHMENTS} draw buffers`);
  const base = opts.shaderBase ?? SHADER_BASE;
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  /** @type {Record<string, string>} */
  const sources = {};
  const load = async (/** @type {string} */ name) => {
    if (!(name in sources)) {
      const res = await fetch(new URL(`${name}.glsl`, base));
      if (!res.ok) throw new Error(`cannot load shader ${name}.glsl (${res.status})`);
      sources[name] = await res.text();
    }
    return sources[name];
  };
  await Promise.all(['common', 'trace', 'trace_kerr_analytic'].map(load));

  /** @param {string} frag @param {string} label */
  const build = (frag, label) => {
    const prog = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]])) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(type));
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${label}: GLSL compile error\n${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${label}: GLSL link error\n${gl.getProgramInfoLog(prog)}`);
    /** @type {Map<string, WebGLUniformLocation|null>} */
    const loc = new Map();
    return { prog, loc: (/** @type {string} */ n) => { if (!loc.has(n)) loc.set(n, gl.getUniformLocation(prog, n)); return loc.get(n) ?? null; } };
  };

  /** a program from its own vertex and fragment sources @param {string} vs @param {string} fs @param {string} label */
  const buildPlain = (vs, fs, label) => {
    const prog = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]])) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(type));
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${label} link: ${gl.getProgramInfoLog(prog)}`);
    return { prog, loc: (/** @type {string} */ n) => gl.getUniformLocation(prog, n) };
  };
  /** @type {ReturnType<typeof buildPlain>|null} */
  let scatterProg = null;

  /** @type {Map<string, ReturnType<typeof build>>} */
  const programs = new Map();
  const FLAG_DEFINES = /** @type {Record<string, string>} */ ({ g34: 'G3_EQUALS_G4', reuse: 'TEXEL_REUSE', bs3: 'BS3', compact: 'COMPACT' });
  const COMPACT_OK = gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 8;
  /**
   * The program for a tracer name of traceConfig.tracerFor: 'trace_kerr_analytic', 'trace', 'closed_<metric>', with
   * '+g34', '+reuse', '+bs3', '+compact' flags. '+compact' (FOORT-GPU's ray compaction: stop at a step limit, resume
   * listed rays) needs 8 draw buffers and 8-attachment targets; the game uses it to split long rays across frames (G3).
   * @param {string} name
   */
  const program = async (name) => {
    let p = programs.get(name);
    if (p) return p;
    const [b, ...flags] = name.split('+');
    if (b.endsWith('_half')) throw new Error('half-float tables are not supported');
    if (flags.includes('compact') && !COMPACT_OK) throw new Error('ray splitting (compaction) needs 8 draw buffers');
    const closed = b.startsWith('closed_') ? b.slice(7) : null;
    const file = closed ? 'trace' : b;
    const pre = closed ? '#define CLOSED_FORM 1\n' + await load(`closed/${closed}`) + '\n' : '';
    const defs = flags.map((f) => {
      if (!FLAG_DEFINES[f]) throw new Error(`unsupported tracer flag ${f}`);
      return `#define ${FLAG_DEFINES[f]} 1\n`;
    }).join('');
    p = build(HEADER + `#define TAIL_BINS ${TAIL_BINS}\n` + defs + pre + await load(file) + '\n' + await load('common'), name);
    programs.set(name, p);
    return p;
  };

  /** @type {WebGLTexture|null} */
  let tableTex = null, fluidTex = null;
  /** @type {any} */
  let fluidGrid = null;
  const vao = gl.createVertexArray();

  /** @param {ReturnType<typeof build>} p @param {Uniforms} u */
  const setUniforms = (p, u) => {
    for (const [name, [type, val]] of Object.entries(u)) {
      const l = p.loc(name);
      if (!l) continue;
      if (type === '4f') gl.uniform4fv(l, Array.from(val));
      else if (type === '4i') gl.uniform4iv(l, Array.from(val, (x) => Math.round(x)));
      else gl.uniformMatrix4fv(l, false, Float32Array.from(val));
    }
  };

  /** @param {number} w @param {number} h @param {number} [nAtt] 6 (the record) or 8 (+ compaction state) @returns {RecordTarget} */
  const makeTarget = (w, h, nAtt = RECORD_ATTACHMENTS) => {
    const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const tex = [];
    for (let k = 0; k < nAtt; k++) {
      const t = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
      tex.push(t);
    }
    gl.drawBuffers(tex.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`record target incomplete (0x${st.toString(16)})`);
    return { fbo, tex, w, h };
  };

  return {
    gl, timerExt,

    /** a record target: 6 RGBA32F attachments (the 24-float record), or 8 with the compaction state */
    makeTarget,
    compactSupported: () => COMPACT_OK,

    /** @param {RecordTarget} T */
    freeTarget(T) { gl.deleteFramebuffer(T.fbo); T.tex.forEach((t) => gl.deleteTexture(t)); },

    /** zero a target (steps = 0 marks "not traced") @param {RecordTarget} T */
    clearTarget(T) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      const z = new Float32Array(4);
      for (let k = 0; k < T.tex.length; k++) gl.clearBufferfv(gl.COLOR, k, z);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /** compile (once) the program of a setup; resolves when it is ready @param {string} name */
    prepare: (/** @type {string} */ name) => program(name),

    /** metric tables (bake.js layout) -> RGBA32F texture, FOORT-GPU's packing @param {any} T */
    uploadTables(T) {
      const g = T.grid;
      if (tableTex) gl.deleteTexture(tableTex);
      tableTex = gl.createTexture();
      if (5 * g.nth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || g.nx > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error(`metric table ${g.nx} x ${g.nth} exceeds MAX_TEXTURE_SIZE`);
      // derivative channels pre-multiplied by the cell size; the five functions of a node in adjacent rows
      const packed = new Float32Array(T.data.length), row = 4 * g.nx;
      const sc = [1, g.dx, g.dth, g.dx * g.dth];
      for (let k = 0; k < 5; k++) for (let j = 0; j < g.nth; j++) {
        const src = (k * g.nth + j) * row, dst = (5 * j + k) * row;
        for (let q = 0; q < row; q++) packed[dst + q] = T.data[src + q] * sc[q & 3];
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tableTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, g.nx, 5 * g.nth);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, 5 * g.nth, gl.RGBA, gl.FLOAT, packed);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    },

    /** the current fluid-table texture and grid (the display reads the circumferential radius) */
    fluid: () => ({ tex: fluidTex, grid: fluidGrid }),

    /** fluid table (fluidTable.js) -> RGBA32F n x 1 @param {any} F */
    uploadFluid(F) {
      if (fluidTex) gl.deleteTexture(fluidTex);
      fluidTex = gl.createTexture();
      fluidGrid = F.grid;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fluidTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, F.grid.n, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, F.grid.n, 1, gl.RGBA, gl.FLOAT, F.data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    },

    /**
     * Issue one trace draw over `rect` of target T (no wait). The program must have been prepared.
     * `extra`: uImg override (resume passes: the size of the image the rays belong to, not of the compact target) and
     * extra textures by uniform name (uIndex, uPrev0-7), bound from unit 2 on.
     * @param {string} name program @param {Uniforms} uniforms @param {RecordTarget} T @param {Rect} rect
     * @param {{img?: number[], textures?: Record<string, WebGLTexture|null>}} [extra]
     */
    encodeChunk(name, uniforms, T, rect, extra) {
      const p = programs.get(name);
      if (!p) throw new Error(`program ${name} not prepared`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.viewport(0, 0, T.w, T.h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.w, rect.h);
      gl.useProgram(p.prog);
      gl.bindVertexArray(vao);
      setUniforms(p, uniforms);
      if (p.loc('uTables')) {
        if (!tableTex) throw new Error('uploadTables first');
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tableTex);
        gl.uniform1i(p.loc('uTables'), 0);
      }
      if (!fluidTex) throw new Error('uploadFluid first');
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fluidTex);
      gl.uniform1i(p.loc('uFluid'), 1);
      const img = extra?.img ?? [T.w, T.h];
      gl.uniform4i(p.loc('uImg'), img[0], img[1], 0, 0);
      // the compaction program's integer sampler uIndex must not share a texture unit with a float sampler (WebGL then
      // refuses the draw, silently): when it is not used (mode 1), it points at a unit of its own
      if (p.loc('uIndex') && !extra?.textures?.uIndex) gl.uniform1i(p.loc('uIndex'), 15);
      let unit = 2;
      for (const [n, t] of Object.entries(extra?.textures ?? {})) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(p.loc(n), unit++);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let u = 2; u < unit; u++) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Read a target back asynchronously (PBO + polled fence): 24 floats per pixel, row 0 at the bottom.
     * @param {RecordTarget} T @returns {Promise<Float32Array>}
     */
    async readRecords(T) {   // the 24-float record (attachments 0-5)
      const n = T.w * T.h;
      const pbos = T.tex.slice(0, RECORD_ATTACHMENTS).map((_, k) => {
        const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 16 * n, gl.STREAM_READ);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
        gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.FLOAT, 0);
        return pbo;
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      await fenceDone(gl);
      const out = new Float32Array(RECORD_FLOATS * n), one = new Float32Array(4 * n);
      pbos.forEach((pbo, k) => {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, one);
        for (let p = 0; p < n; p++) for (let c = 0; c < 4; c++) out[RECORD_FLOATS * p + 4 * k + c] = one[4 * p + c];
        gl.deleteBuffer(pbo);
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return out;
    },

    /**
     * Attachment 0 (termination code, steps, theta, phi) of a rectangle, read back asynchronously (PBO + polled fence).
     * @param {RecordTarget} T @param {Rect} [rect] @returns {Promise<Float32Array>}
     */
    async readRec0(T, rect = { x: 0, y: 0, w: T.w, h: T.h }) {
      const n = rect.w * rect.h;
      const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 16 * n, gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.FLOAT, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      await fenceDone(gl);
      const out = new Float32Array(4 * n);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
      return out;
    },

    /** an R32I texture of pixel indices (-1: padding) @param {number} w @param {number} h @param {Int32Array} data */
    indexTexture(w, h, data) {
      const t = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, w, h);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED_INTEGER, gl.INT, data);
      for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return t;
    },

    /**
     * Scatter a compact image's records (8 attachments) back to their pixels of target T (8 attachments): one point per
     * compact texel; padding texels (index -1) are dropped. After FOORT-GPU's scatter pass (backendWebGL2.js).
     * @param {RecordTarget} C compact image @param {WebGLTexture} index its index texture @param {RecordTarget} T
     */
    scatter(C, index, T) {
      if (!scatterProg) scatterProg = buildPlain(SCATTER_VS, SCATTER_FS, 'scatter');
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.viewport(0, 0, T.w, T.h);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(scatterProg.prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, index); gl.uniform1i(scatterProg.loc('uIndex'), 0);
      for (let k = 0; k < 8; k++) { gl.activeTexture(gl.TEXTURE1 + k); gl.bindTexture(gl.TEXTURE_2D, C.tex[k]); gl.uniform1i(scatterProg.loc(`uC${k}`), 1 + k); }
      gl.uniform4i(scatterProg.loc('uSc'), T.w, T.h, C.w, 0);
      gl.drawArrays(gl.POINTS, 0, C.w * C.h);
      for (let k = 0; k < 9; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
  };
}

/** Wait for everything queued so far without blocking the page (fence polled on event-loop yields). @param {WebGL2RenderingContext} gl */
export async function fenceDone(gl) {
  const sync = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
  gl.flush();
  for (;;) {
    const st = gl.clientWaitSync(sync, 0, 0);
    if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
    if (st === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
    if (gl.isContextLost()) throw new Error('WebGL context lost (GPU watchdog?)');
    await yieldNow();
  }
  gl.deleteSync(sync);
}

/** @typedef {Awaited<ReturnType<typeof createTracer>>} Tracer */

const SCATTER_VS = `#version 300 es
precision highp float; precision highp int;
uniform highp isampler2D uIndex;
uniform ivec4 uSc;   // target width, height, compact width, 0
flat out ivec2 vC;
void main() {
  int k = gl_VertexID;
  ivec2 c = ivec2(k % uSc.z, k / uSc.z);
  int p = texelFetch(uIndex, c, 0).x;
  vC = c;
  gl_PointSize = 1.0;
  if (p < 0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 ij = vec2(float(p % uSc.x), float(p / uSc.x));
  gl_Position = vec4((ij + 0.5) / vec2(uSc.xy) * 2.0 - 1.0, 0.0, 1.0);
}`;
const SCATTER_FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uC0, uC1, uC2, uC3, uC4, uC5, uC6, uC7;
flat in ivec2 vC;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
layout(location = 4) out vec4 o4; layout(location = 5) out vec4 o5; layout(location = 6) out vec4 o6; layout(location = 7) out vec4 o7;
void main() {
  o0 = texelFetch(uC0, vC, 0); o1 = texelFetch(uC1, vC, 0); o2 = texelFetch(uC2, vC, 0); o3 = texelFetch(uC3, vC, 0);
  o4 = texelFetch(uC4, vC, 0); o5 = texelFetch(uC5, vC, 0); o6 = texelFetch(uC6, vC, 0); o7 = texelFetch(uC7, vC, 0);
}`;

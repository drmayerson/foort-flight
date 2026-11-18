// @ts-check
// The game's display (G2): records of a direct trace -> HDR image (shaders/glsl/display.glsl) -> canvas
// (shaders/glsl/tonemap.glsl), with auto-exposure ("eye adaptation", plan 4.5) from the mean luminance of the HDR
// image, read back asynchronously (mipmap level 1 x 1, PBO + fence) every few frames: never a CPU wait.

import { blackbodyTable, BB_TMIN, BB_TMAX, BB_N } from '../render/blackbody.js';
import { noiseFadeWidth } from '../../vendor/foort-gpu/js/noise/noiseField.js';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler3D;\n';
const BASE = new URL('../../shaders/glsl/', import.meta.url).href;
/** auto-exposure key on the mean luminance: low, since half the view is often the shadow and the sky (G2 tuning) */
export const KEY = 0.06;

/**
 * @typedef {Object} DisplayParams
 * @property {number} colorMode      0 FOORT colour map, 1 blackbody
 * @property {number} skyMode        0 none, 1 stars, 2 picture
 * @property {{mu:number, gamma:number, sigma:number, p:number, fudge:number, maxPasses:number, circumferential:boolean}} em
 * @property {number} exposure       mode 0: FOORT exposure; mode 1: multiplier on the auto-exposure
 * @property {boolean} autoExposure
 * @property {number} T0             blackbody: temperature at r_ref (K)
 * @property {number} rRef
 * @property {number} sigmaN         noise amplitude (0: time-averaged disc)
 * @property {number} tObs           observer coordinate time (M)
 * @property {boolean} slowLight
 * @property {number} azimuth        added to every phi (rad)
 * @property {number} starBrightness
 * @property {number} pixelAngle     rad
 */

/** @param {WebGL2RenderingContext} gl */
export async function createDisplay(gl) {
  const src = async (/** @type {string} */ n) => { const r = await fetch(new URL(n, BASE)); if (!r.ok) throw new Error(`cannot load ${n}`); return r.text(); };
  /** @param {string} fs @param {string} label */
  const build = (fs, label) => {
    const prog = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, s] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, HEADER + fs]])) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(type));
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${label} link: ${gl.getProgramInfoLog(prog)}`);
    /** @type {Map<string, WebGLUniformLocation|null>} */
    const cache = new Map();
    const loc = (/** @type {string} */ n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n)); return cache.get(n) ?? null; };
    return { prog, loc };
  };
  const disp = build(await src('display.glsl'), 'display.glsl');
  const tone = build(await src('tonemap.glsl'), 'tonemap.glsl');
  const vao = gl.createVertexArray();
  const tex2 = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ fmt) => {
    const t = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    return t;
  };

  // blackbody table
  const bbTex = tex2(BB_N, 1, gl.RGBA32F);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BB_N, 1, gl.RGBA, gl.FLOAT, blackbodyTable());
  const linearFloat = !!gl.getExtension('OES_texture_float_linear');
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, linearFloat ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  // placeholders: 1-texel noise (off), sky picture
  let noiseTex = /** @type {WebGLTexture} */ (gl.createTexture());
  gl.bindTexture(gl.TEXTURE_3D, noiseTex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
  /** @type {any} */
  let noiseMeta = null;
  let skyTex = /** @type {WebGLTexture} */ (gl.createTexture());
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  let skyAspect = 1;

  /** HDR target with mipmaps (auto-exposure reads the 1 x 1 level) */
  /** @type {{tex: WebGLTexture, fbo: WebGLFramebuffer, w: number, h: number, levels: number}|null} */
  let hdr = null, raw = null;
  const makeHdr = (/** @type {number} */ w, /** @type {number} */ h, /** @type {boolean} */ mips, /** @type {number} */ fmt) => {
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    const tex = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mips ? gl.LINEAR : gl.NEAREST);
    const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h, levels };
  };
  // auto-exposure state
  let exposureAuto = 1, lastRead = 0;
  /** @type {{pbo: WebGLBuffer, sync: WebGLSync}|null} */
  let pending = null;
  const lumFbo = gl.createFramebuffer();

  /** @param {WebGLTexture} t @param {number} unit @param {WebGLUniformLocation|null} l @param {number} [target] */
  const bind = (t, unit, l, target = gl.TEXTURE_2D) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); gl.uniform1i(l, unit); };

  const api = {
    /** @param {import('../../vendor/foort-gpu/js/noise/noiseField.js').NoiseField} F */
    setNoise(F) {
      const m = F.meta;
      gl.deleteTexture(noiseTex);
      noiseTex = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, m.Nphi, m.Nx, m.Nt, 0, gl.RED, gl.HALF_FLOAT, F.half);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
      noiseMeta = m;
    },
    noiseMeta: () => noiseMeta,

    /** @param {TexImageSource} img */
    setSkyPicture(img) {
      gl.deleteTexture(skyTex);
      skyTex = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, skyTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      const any = /** @type {any} */ (img);
      skyAspect = (any.naturalWidth ?? any.width) / (any.naturalHeight ?? any.height);
    },

    exposure: () => exposureAuto,

    /**
     * Draw records (and the camera that traced them) into the HDR target, then tone-map into the canvas viewport.
     * @param {import('./tracer.js').RecordTarget} T
     * @param {Record<string, any>} cam uniforms of the camera: uE, uG, uCam, uScreen
     * @param {any} fluid tracer.fluid()
     * @param {{xLo:number, invWidth:number, K:number}|null} tailGeom
     * @param {DisplayParams} P
     * @param {{x?: number, y?: number, w?: number, h?: number, raw?: boolean, M?: number, skyTheta?: number, skyHalf?: number}} [o]
     */
    draw(T, cam, fluid, tailGeom, P, o = {}) {
      const w = T.w, h = T.h;
      if (!hdr || hdr.w !== w || hdr.h !== h) {
        if (hdr) { gl.deleteTexture(hdr.tex); gl.deleteFramebuffer(hdr.fbo); }
        hdr = makeHdr(w, h, true, gl.RGBA16F);
      }
      let target = hdr;
      if (o.raw) {
        if (!raw || raw.w !== w || raw.h !== h) { if (raw) { gl.deleteTexture(raw.tex); gl.deleteFramebuffer(raw.fbo); } raw = makeHdr(w, h, false, gl.RGBA32F); }
        target = raw;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(disp.prog);
      gl.bindVertexArray(vao);
      const L = disp.loc;
      for (let k = 0; k < 6; k++) bind(T.tex[k], k, L(`uR${k}`));
      gl.uniform4i(L('uImg'), w, h, 0, 0);
      gl.uniformMatrix4fv(L('uE'), false, Float32Array.from(cam.uE[1]));
      gl.uniformMatrix4fv(L('uG'), false, Float32Array.from(cam.uG[1]));
      gl.uniform4fv(L('uCam'), Array.from(cam.uCam[1]));
      gl.uniform4fv(L('uScreen'), Array.from(cam.uScreen[1]));
      gl.uniform4i(L('uView'), P.colorMode, P.skyMode, tailGeom ? 1 : 0, o.raw ? 1 : 0);
      gl.uniform4f(L('uEm'), P.em.mu, P.em.gamma, P.em.sigma, P.em.p);
      gl.uniform4f(L('uEm2'), P.em.fudge, P.em.maxPasses, P.em.circumferential ? 1 : 0, P.exposure);
      gl.uniform4f(L('uTail'), tailGeom?.xLo ?? 0, tailGeom?.invWidth ?? 1, tailGeom?.K ?? 0, 0);
      bind(noiseTex, 6, L('uNoise'), gl.TEXTURE_3D);
      const m = noiseMeta;
      const on = m && P.sigmaN > 0;
      gl.uniform4i(L('uNoiseN'), m?.Nt ?? 1, m?.Nx ?? 1, m?.Nphi ?? 1, on ? 1 : 0);
      gl.uniform4f(L('uNoiseP'), on ? P.sigmaN : 0, m?.T_over_M ?? 1, m?.xmin ?? 0, m?.xmax ?? 1);
      gl.uniform4f(L('uNoiseFade'), m ? noiseFadeWidth(m) : 1, 0, 0, 0);
      const Tn = m?.T_over_M ?? 1;
      gl.uniform4f(L('uTime'), P.tObs - Math.floor(P.tObs / Tn) * Tn, P.slowLight ? 1 : 0, o.M ?? 1, P.azimuth);
      bind(fluid.tex, 7, L('uFluidD'));
      gl.uniform4f(L('uFluidXD'), fluid.grid.xMin, fluid.grid.dx, fluid.grid.n, fluid.grid.r0);
      bind(bbTex, 8, L('uBB'));
      gl.uniform4f(L('uBBP'), Math.log(BB_TMIN), Math.log(BB_TMAX), P.T0, P.rRef);
      bind(skyTex, 9, L('uSky'));
      gl.uniform4f(L('uSkyP'), 1, o.skyHalf ?? 0.3, skyAspect, P.starBrightness);
      const sth = o.skyTheta ?? Math.PI / 2;
      gl.uniform4f(L('uSkyCam'), Math.sin(sth), Math.cos(sth), P.pixelAngle, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let k = 0; k < 10; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindTexture(gl.TEXTURE_3D, null); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (o.raw) return;

      // auto-exposure: mean luminance of the HDR image (1 x 1 mip), read back asynchronously
      if (P.colorMode === 1 && P.autoExposure) {
        gl.bindTexture(gl.TEXTURE_2D, hdr.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (pending) {
          const st = gl.clientWaitSync(pending.sync, 0, 0);
          if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
            const v = new Float32Array(4);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pending.pbo);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, v);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.deleteBuffer(pending.pbo); gl.deleteSync(pending.sync); pending = null;
            const lum = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
            if (lum > 0 && Number.isFinite(lum)) {
              // key KEY on the mean luminance, smoothed (eye adaptation over ~0.5 s)
              const target = KEY / lum;
              exposureAuto = exposureAuto * 0.85 + target * 0.15;
            }
          }
        }
        const now = performance.now();
        if (!pending && now - lastRead > 100) {
          lastRead = now;
          gl.bindFramebuffer(gl.FRAMEBUFFER, lumFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hdr.tex, hdr.levels - 1);
          const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
          gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          pending = { pbo, sync: /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)) };
        }
      }
      // tone pass into the canvas
      const c = /** @type {HTMLCanvasElement} */ (gl.canvas);
      const x = o.x ?? 0, y = o.y ?? 0, vw = o.w ?? c.width, vh = o.h ?? c.height;
      gl.viewport(x, y, vw, vh);
      gl.useProgram(tone.prog);
      bind(hdr.tex, 0, tone.loc('uSrc'));
      gl.uniform4f(tone.loc('uTone'), P.colorMode === 1 ? 1 : 0, P.colorMode === 1 ? (P.autoExposure ? exposureAuto : 1) * P.exposure : 1, 0, 0);
      gl.uniform4f(tone.loc('uDst'), x, y, vw, vh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    },

    /** raw values (s, I, code, steps) of the last raw draw, read synchronously (tests only) */
    readRaw() {
      if (!raw) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, raw.fbo);
      const out = new Float32Array(4 * raw.w * raw.h);
      gl.readPixels(0, 0, raw.w, raw.h, gl.RGBA, gl.FLOAT, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w: raw.w, h: raw.h, data: out };
    },
  };
  return api;
}

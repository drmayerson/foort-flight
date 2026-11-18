// @ts-check
// G1 debug display: draws a record target (shaders/glsl/debug.glsl) into a viewport of the canvas.

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

export const DEBUG_MODES = ['four-colour', 'redshift', 'steps', 'termination'];

/** @param {WebGL2RenderingContext} gl @param {string} [shaderUrl] */
export async function createDebugDisplay(gl, shaderUrl = new URL('../../shaders/glsl/debug.glsl', import.meta.url).href) {
  const res = await fetch(shaderUrl);
  if (!res.ok) throw new Error(`cannot load debug.glsl (${res.status})`);
  const prog = /** @type {WebGLProgram} */ (gl.createProgram());
  for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, HEADER + await res.text()]])) {
    const sh = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`debug.glsl: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`debug.glsl link: ${gl.getProgramInfoLog(prog)}`);
  const L = (/** @type {string} */ n) => gl.getUniformLocation(prog, n);
  const loc = { rec0: L('uRec0'), rec1: L('uRec1'), view: L('uView'), aux: L('uAux'), dst: L('uDst') };
  const vao = gl.createVertexArray();
  return {
    /**
     * @param {import('./tracer.js').RecordTarget} T
     * @param {{mode?: number, azimuth?: number, maxSteps?: number, x?: number, y?: number, w?: number, h?: number}} [o]
     */
    draw(T, o = {}) {
      const c = /** @type {HTMLCanvasElement} */ (gl.canvas);
      const x = o.x ?? 0, y = o.y ?? 0, w = o.w ?? c.width, h = o.h ?? c.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(x, y, w, h);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.tex[0]); gl.uniform1i(loc.rec0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.tex[1]); gl.uniform1i(loc.rec1, 1);
      gl.uniform4i(loc.view, o.mode ?? 0, T.w, T.h, 0);
      gl.uniform4f(loc.aux, o.azimuth ?? 0, o.maxSteps ?? 5000, 0, 0);
      gl.uniform4f(loc.dst, x, y, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    },
  };
}

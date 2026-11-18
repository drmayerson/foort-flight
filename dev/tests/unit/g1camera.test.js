// G1: the general pinhole camera reproduces FOORT's static camera, and builds null rays for any observer and face.
import { describe, it, expect } from 'vitest';
import { createMetric } from '../../../vendor/foort-gpu/js/metrics/registry.js';
import { inverseMetric, toMat4 } from '../../../vendor/foort-gpu/js/metrics/common.js';
import { TetradCamera, innerProduct } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { staticFrame, pinholeUniforms, rayMomentum, cubeFaceFrames, boostFrame, rotateFrame } from '../../../js/camera/generalTetrad.js';

const at = (id, params, r, th) => {
  const m = createMetric(id, params);
  return { m, gdd: toMat4(m.g_dd(r, th)), guu: toMat4(inverseMetric(m)(r, th)), pos: [0, r, th, 0.3] };
};
const relMax = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]) / Math.max(1e-300, Math.max(...b.map(Math.abs)))));

describe('pinhole camera = FOORT static camera', () => {
  for (const [id, params, r, th] of [['kerr', { a: 0.94 }, 1000, 17 * Math.PI / 180], ['kerr', { a: 0.9 }, 7, 2.4], ['st3cr', { lambda: 5e-3, P: 2, q0: 50 }, 250 / 24, 1.5]]) {
    it(`${id} r = ${r.toPrecision(4)}, theta = ${th.toFixed(3)}`, () => {
      const { gdd, guu, pos } = at(id, params, r, th);
      const foort = TetradCamera.fromStaticObserver(gdd, guu, pos).vielbeinColumnMajor();
      const ours = pinholeUniforms({ gdd, position: pos, r0: 0, frame: staticFrame(gdd, guu), fov: 0.1 }).uE[1];
      expect(relMax(Array.from(ours), Array.from(foort))).toBeLessThan(1e-6);   // float32 storage of both
    });
  }
});

describe('rays are null and look where the screen points', () => {
  const { gdd, guu, pos } = at('kerr', { a: 0.94 }, 12, 1.1);
  const F0 = staticFrame(gdd, guu);
  const frames = { static: F0, boosted: boostFrame(F0, [0.5, -0.3, 0.6]), rotated: rotateFrame(F0, [[0, -1, 0], [1, 0, 0], [0, 0, 1]]) };
  for (const [name, F] of Object.entries(frames)) {
    it(name, () => {
      const ip = (a, b) => innerProduct(gdd, a, b);
      expect(ip(F.u, F.u)).toBeCloseTo(-1, 12);
      for (const L of [F.f, F.right, F.up]) { expect(ip(L, L)).toBeCloseTo(1, 12); expect(ip(L, F.u)).toBeCloseTo(0, 12); }
      expect(ip(F.f, F.right)).toBeCloseTo(0, 12);
      const cam = pinholeUniforms({ gdd, position: pos, r0: 0, frame: F, fov: Math.PI / 2 });
      const rc = pos[1], delta = cam.uCam[1][1];
      for (const [al, be] of [[0, 0], [rc, 0], [-0.3 * rc, 0.8 * rc]]) {
        const p = rayMomentum(cam.E, rc, delta, al, be);
        expect(ip(p, p)).toBeCloseTo(0, 10);
        expect(ip(p, F.u)).toBeCloseTo(1, 10);   // past-directed, unit local energy
        // spatial direction (f, right, up) components = (rc, alpha, beta) / D
        const D = Math.hypot(rc, al, be);
        expect(ip(p, F.f)).toBeCloseTo(rc / D, 10);
        expect(ip(p, F.right)).toBeCloseTo(al / D, 10);
        expect(ip(p, F.up)).toBeCloseTo(be / D, 10);
      }
    });
  }
});

describe('cube faces', () => {
  const { gdd, guu, pos } = at('kerr', { a: 0.5 }, 30, 0.8);
  const F = staticFrame(gdd, guu);
  const faces = cubeFaceFrames(F);
  const ip = (a, b) => innerProduct(gdd, a, b);
  /** local look direction (f, right, up of the base frame) of face k at (a, b) in [-1, 1] */
  const dir = (k, a, b) => {
    const cam = pinholeUniforms({ gdd, position: pos, r0: 0, frame: faces[k], fov: Math.PI / 2 });
    const rc = pos[1], p = rayMomentum(cam.E, rc, cam.uCam[1][1], a * rc, b * rc);
    return [ip(p, F.f), ip(p, F.right), ip(p, F.up)];
  };
  it('face centres are the six axis directions', () => {
    const want = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    faces.forEach((_, k) => dir(k, 0, 0).forEach((x, i) => expect(x).toBeCloseTo(want[k][i], 12)));
  });
  it('right-handed and seamless: front edge = right-face edge', () => {
    for (const b of [-0.7, 0, 0.4]) {
      const d1 = dir(0, 1, b), d2 = dir(2, -1, b);
      d1.forEach((x, i) => expect(x).toBeCloseTo(d2[i], 12));
      const u1 = dir(0, b, 1), u2 = dir(4, b, -1);
      u1.forEach((x, i) => expect(x).toBeCloseTo(u2[i], 12));
    }
  });
});

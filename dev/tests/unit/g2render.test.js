// G2: the ship-coordinate camera path reproduces FOORT's static camera (so its images are G1's), and blackbody colours.
import { describe, it, expect } from 'vitest';
import { createSpacetime } from '../../../js/physics/spacetime.js';
import { observerState, shipCamera } from '../../../js/camera/shipCamera.js';
import { TetradCamera } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';
import { blackbodyRGB, blackbodyTable, BB_N } from '../../../js/render/blackbody.js';

describe('ship camera = FOORT camera for a static observer', () => {
  for (const [id, params, r, th] of [['kerr', { a: 0.94 }, 1000, 17 * Math.PI / 180], ['kerr', { a: 0.5 }, 6, 2.0], ['st3cr', { lambda: 5e-3 }, 250 / 24, 1.5]]) {
    it(`${id} r = ${r.toPrecision(4)}`, () => {
      const S = createSpacetime(id, params);
      const ob = observerState(S, { kind: 'static', r, theta: th });
      const fov = 2 * Math.atan(15 / (2 * r));
      const cam = shipCamera(S, ob.X, ob.F, fov);
      expect(cam.position[1]).toBeCloseTo(r, 9);
      expect(cam.position[2]).toBeCloseTo(th, 9);
      const foort = TetradCamera.fromStaticObserver(S.gTracer(r, th), S.gTracerInv(r, th), [0, r, th, 0]).vielbeinColumnMajor();
      const ours = cam.uE[1];
      const scale = Math.max(...Array.from(foort).map(Math.abs));
      for (let i = 0; i < 16; i++) expect(Math.abs(ours[i] - foort[i]) / scale).toBeLessThan(2e-7);   // float32 storage
    });
  }
});

describe('blackbody colours', () => {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it('luminance 1, red when cool, blue when hot, near white at 6500 K', () => {
    for (const T of [1000, 3000, 6500, 20000, 50000]) expect(lum(blackbodyRGB(T))).toBeCloseTo(1, 9);
    const c3 = blackbodyRGB(3000), c20 = blackbodyRGB(20000), c65 = blackbodyRGB(6500);
    expect(c3[0]).toBeGreaterThan(c3[2] * 2);
    expect(c20[2]).toBeGreaterThan(c20[0]);
    expect(Math.max(...c65) / Math.min(...c65)).toBeLessThan(1.15);
    expect(blackbodyRGB(1000).every((v) => v >= 0)).toBe(true);
    expect(blackbodyTable().length).toBe(4 * BB_N);
  });
});

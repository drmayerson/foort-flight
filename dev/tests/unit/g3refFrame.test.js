// G3: the ship -> reference map of the cubemap display, its staleness measure, and the atlas face cameras.
import { describe, it, expect } from 'vitest';
import { createSpacetime } from '../../../js/physics/spacetime.js';
import { referenceFrame, shipToReference, staleness, cubeFaceCameras, zamoFrame } from '../../../js/physics/refFrame.js';
import { boostFrame, rayMomentum } from '../../../js/camera/generalTetrad.js';
import { withAttitude } from '../../../js/physics/observers.js';
import { innerProduct } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';

const S = createSpacetime('kerr', { a: 0.9 });
const ETA = [-1, 1, 1, 1];
const legs = (F) => [F.u, F.f, F.right, F.up];

describe('ship -> reference frame', () => {
  const r = 9, th = 1.2, g = S.gTracer(r, th);
  const Z = zamoFrame(g);
  it('identity for a ship without attitude at the reference', () => {
    const ship = boostFrame(Z, [0.3, 0.5, -0.2]);
    const ref = referenceFrame(g, ship);
    const { M } = shipToReference(g, ship, g, ref.frame, ref.v);
    M.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
  });
  it('the attitude rotation for a turned ship; Lorentz in general', () => {
    const ship = withAttitude(boostFrame(Z, [0.6, 0, 0]), { yaw: 0.7, pitch: -0.3, roll: 0.2 });
    const ref = referenceFrame(g, ship);
    const { M } = shipToReference(g, ship, g, ref.frame, ref.v);
    expect(M[0][0]).toBeCloseTo(1, 10);
    for (let i = 1; i < 4; i++) expect(M[0][i]).toBeCloseTo(0, 10);
    // M^T eta M = eta
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      let s = 0; for (let k = 0; k < 4; k++) s += M[k][a] * ETA[k] * M[k][b];
      expect(s).toBeCloseTo(a === b ? ETA[a] : 0, 10);
    }
  });
  it('a stale velocity: M maps ray components exactly (same point)', () => {
    const refShip = boostFrame(Z, [0.5, 0.1, 0]);
    const ref = referenceFrame(g, refShip);
    const ship = withAttitude(boostFrame(Z, [-0.4, 0.3, 0.2]), { yaw: 1.1 });
    const { M } = shipToReference(g, ship, g, ref.frame, ref.v);
    const ps = [-1, 0.6, -0.48, 0.64];   // (-1, d) with |d| = 1
    const p = [0, 1, 2, 3].map((mu) => legs(ship).reduce((acc, L, b) => acc + ps[b] * L[mu], 0));
    const want = legs(ref.frame).map((L, a) => ETA[a] * innerProduct(g, p, L));
    const got = M.map((row) => row.reduce((acc, v, b) => acc + v * ps[b], 0));
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
    const st = staleness({ r, theta: th }, { r, theta: th }, M);
    expect(st.pos).toBe(0);
    expect(st.vel).toBeGreaterThan(0.5);
  });
  it('staleness grows with displacement and is a Lorentz map across points', () => {
    const g2 = S.gTracer(10, th);
    const ship = boostFrame(zamoFrame(g2), [0.2, 0, 0]);
    const ref = referenceFrame(g, boostFrame(Z, [0.2, 0, 0]));
    const { M } = shipToReference(g2, ship, g, ref.frame, ref.v);
    expect(staleness({ r: 10, theta: th }, { r, theta: th }, M).pos).toBeCloseTo(0.1, 10);
    M.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));   // same ZAMO-frame velocity
  });
});

describe('atlas face cameras', () => {
  it('each face texel gets the screen point of its own face', () => {
    const r = 9, th = 1.2, g = S.gTracer(r, th), N = 16, W = 3 * N, H = 2 * N;
    const faces = cubeFaceCameras({ gdd: g, position: [0, r, th, 0], r0: S.rHorizon, frame: zamoFrame(g), N });
    faces.forEach((f, k) => {
      const [cx, cy, sx, sy] = f.uScreen[1];
      for (const [i, j] of [[0, 0], [N - 1, 3], [7, N - 1]]) {
        const ux = (f.rect.x + i + 0.5) / W, uy = (f.rect.y + j + 0.5) / H;
        const alpha = cx + sx * (ux - 0.5), beta = cy + sy * (uy - 0.5);
        // the face screen spans [-r, r] (90 degrees at focal length r)
        expect(alpha).toBeCloseTo(2 * r * ((i + 0.5) / N - 0.5), 9);
        expect(beta).toBeCloseTo(2 * r * ((j + 0.5) / N - 0.5), 9);
        // and the ray is null
        const p = rayMomentum(f.E, r, f.uCam[1][1], alpha, beta);
        expect(innerProduct(g, p, p)).toBeCloseTo(0, 9);
      }
    });
  });
});

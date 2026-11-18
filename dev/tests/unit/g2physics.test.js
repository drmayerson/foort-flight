// G2 physics: ship coordinates (Kerr-Schild, ST3Cr base Cartesian) against the vendored tracer metrics, observer
// families, and the ship-frame redshift in its known limits (hovering blueshift, Doppler, aberration).
import { describe, it, expect } from 'vitest';
import { createSpacetime } from '../../../js/physics/spacetime.js';
import { createKerrKS, inv4 } from '../../../js/physics/ksKerr.js';
import { observer, baseFrame, withAttitude, zamo } from '../../../js/physics/observers.js';
import { shipShift, aberrate, dopplerFlat } from '../../../js/physics/redshift.js';
import { staticFrame, pinholeUniforms, rayMomentum, boostFrame } from '../../../js/camera/generalTetrad.js';
import { innerProduct } from '../../../vendor/foort-gpu/js/camera/tetradCamera.js';

const T = (M) => M[0].map((_, j) => M.map((row) => row[j]));
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
const det4 = (M) => {
  const A = M.map((r) => [...r]); let d = 1;
  for (let c = 0; c < 4; c++) {
    let p = c; for (let i = c + 1; i < 4; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = -d; }
    d *= A[c][c];
    for (let i = c + 1; i < 4; i++) { const f = A[i][c] / A[c][c]; for (let j = c; j < 4; j++) A[i][j] -= f * A[c][j]; }
  }
  return d;
};
const maxRel = (A, B) => {
  const scale = Math.max(...B.flat().map(Math.abs));
  return Math.max(...A.flat().map((v, i) => Math.abs(v - B.flat()[i]))) / scale;
};

describe('Kerr-Schild vs Boyer-Lindquist', () => {
  for (const a of [0, 0.5, 0.94]) {
    for (const [r, th, ph] of [[3, 0.7, 0.3], [12, 1.9, 4], [50, 0.2, 2.2], [2.4, Math.PI / 2, 1]]) {
      it(`a = ${a}, r = ${r}, theta = ${th}`, () => {
        const S = createSpacetime('kerr', { a });
        const B = [7, r, th, ph];
        const X = S.fromTracer(B);
        const B2 = S.toTracer(X);
        expect(B2[0]).toBeCloseTo(B[0], 10); expect(B2[1]).toBeCloseTo(r, 10); expect(B2[2]).toBeCloseTo(th, 10);
        expect(((B2[3] - ph) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI).toBeCloseTo(0, 10);
        // the metric transforms: g_KS = J^T g_BL J, J = d(BL)/d(KS)
        const J = S.jacobian(X);
        expect(maxRel(S.gShip(X), mul(mul(T(J), S.gTracer(r, th)), J))).toBeLessThan(1e-11);
        // analytic Jacobian vs differences of toTracer
        const h = 1e-6;
        for (let j = 0; j < 4; j++) {
          const Xp = [...X], Xm = [...X]; Xp[j] += h; Xm[j] -= h;
          const d = S.toTracer(Xp).map((v, i) => { let x = v - S.toTracer(Xm)[i]; if (i === 3) x = ((x + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; return x / (2 * h); });
          d.forEach((v, i) => expect(Math.abs(v - J[i][j])).toBeLessThan(1e-6 * (1 + Math.abs(J[i][j]))));
        }
      });
    }
  }
  it('regular at and inside the horizon and on the axis', () => {
    const ks = createKerrKS(0.9);
    for (const X of [[0, 0, 0, 5], [0, 0, 0, -1.2], [0, 1.0, 0.3, 0.2], [0, 1e-9, 0, 3]]) {
      const g = ks.g(X);
      g.flat().forEach((v) => expect(Number.isFinite(v)).toBe(true));
      // Lorentzian: det < 0 (for Kerr-Schild det g = -1 exactly, as for Minkowski)
      expect(det4(g)).toBeCloseTo(-1, 9);
      // and inv4 inverts it
      mul(g, inv4(g)).forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 9)));
    }
    // a point inside the horizon (r < r+ = 1.436)
    expect(ks.r([0, 0.8, 0.3, 0.4])).toBeLessThan(ks.rp);
  });
});

describe('ST3Cr in base Cartesian coordinates', () => {
  for (const [id, params] of [['st3cr', { lambda: 5e-3 }], ['st3cr', { lambda: 0.05 }], ['st3crBH', {}]]) {
    it(`${id} ${JSON.stringify(params)}`, () => {
      const S = createSpacetime(/** @type {any} */ (id), params);
      for (const [r, th, ph] of [[0.3, 0.8, 0.4], [3, 2.0, 5], [40, 1.2, 1]]) {
        const X = S.fromTracer([0, r, th, ph]);
        const J = S.jacobian(X);
        expect(maxRel(S.gShip(X), mul(mul(T(J), S.gTracer(r, th)), J))).toBeLessThan(1e-10);
        const g = S.gTracer(r, th);
        expect(g[2][2] / (r * r * g[1][1])).toBeCloseTo(1, 10);   // conformally flat base
      }
      // on the axis: finite, and continuous with points next to it
      const g0 = S.gShip([0, 0, 0, 2]), g1 = S.gShip([0, 1e-5, 0, 2]);
      g0.flat().forEach((v, i) => { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v - g1.flat()[i])).toBeLessThan(1e-6); });
    });
  }
});

describe('observers', () => {
  const S = createSpacetime('kerr', { a: 0.9 });
  const gAt = S.gTracer;
  it('ZAMO: unit, zero angular momentum', () => {
    const z = zamo(gAt(4, 1.0));
    expect(innerProduct(gAt(4, 1.0), z.u, z.u)).toBeCloseTo(-1, 12);
    const uphi = gAt(4, 1.0)[3].reduce((s, gi, i) => s + gi * z.u[i], 0);
    expect(uphi).toBeCloseTo(0, 12);
  });
  it('static observers do not exist in the ergoregion', () => {
    expect(observer('static', gAt, 1.8, Math.PI / 2).u).toBeNull();
    expect(observer('static', gAt, 1.8, Math.PI / 2).reason).toMatch(/ergoregion/);
    expect(observer('static', gAt, 2.1, Math.PI / 2).u).not.toBeNull();
    expect(observer('zamo', gAt, 1.8, Math.PI / 2).u).not.toBeNull();
  });
  it('circular orbits: Kerr Omega = +-1 / (r^1.5 +- a)', () => {
    for (const r of [4, 10]) {
      const pro = observer('circularPro', gAt, r, Math.PI / 2), retro = observer('circularRetro', gAt, r, Math.PI / 2);
      expect(pro.u[3] / pro.u[0]).toBeCloseTo(1 / (r ** 1.5 + 0.9), 9);
      expect(retro.u[3] / retro.u[0]).toBeCloseTo(-1 / (r ** 1.5 - 0.9), 9);
      expect(innerProduct(gAt(r, Math.PI / 2), pro.u, pro.u)).toBeCloseTo(-1, 9);
    }
    expect(observer('circularPro', gAt, 1.4, Math.PI / 2).u).toBeNull();   // inside the photon orbit
    expect(observer('circularPro', gAt, 6, 1.0).u).toBeNull();             // off the equator
  });
  it('the base frame of a static observer is FOORT\'s camera frame', () => {
    const g = gAt(30, 0.7), F = staticFrame(g, S.gTracerInv(30, 0.7));
    const B = baseFrame(g, observer('static', gAt, 30, 0.7).u);
    for (const k of ['u', 'f', 'right', 'up']) B[k].forEach((v, i) => expect(v).toBeCloseTo(F[k][i], 12));
  });
  it('attitude: yaw turns f towards right, the frame stays orthonormal', () => {
    const g = gAt(30, 0.7), B = baseFrame(g, zamo(g).u);
    const A = withAttitude(B, { yaw: 0.3, pitch: -0.2, roll: 1.1 });
    const ip = (a, b) => innerProduct(g, a, b);
    for (const L of [A.f, A.right, A.up]) { expect(ip(L, L)).toBeCloseTo(1, 12); expect(ip(L, A.u)).toBeCloseTo(0, 12); }
    expect(ip(A.f, A.right)).toBeCloseTo(0, 12); expect(ip(A.right, A.up)).toBeCloseTo(0, 12);
    const Y = withAttitude(B, { yaw: 0.3 });
    expect(ip(Y.f, B.right)).toBeCloseTo(Math.sin(0.3), 12);
  });
});

describe('ship-frame redshift', () => {
  const cam = (S, r, th, F) => {
    const g = S.gTracer(r, th);
    return { g, P: pinholeUniforms({ gdd: g, position: [0, r, th, 0], r0: S.rHorizon, frame: F, fov: Math.PI / 2 }) };
  };
  it('a hovering observer in Schwarzschild sees light from infinity blueshifted by 1/sqrt(1 - 2/r)', () => {
    const S = createSpacetime('kerr', { a: 0 });
    for (const r of [3, 6, 20]) {
      const g = S.gTracer(r, 1.0), F = staticFrame(g, S.gTracerInv(r, 1.0));
      const { P } = cam(S, r, 1.0, F);
      for (const [al, be] of [[0, 0], [r, 0], [-0.4 * r, 0.9 * r]]) {
        const p = rayMomentum(P.E, r, P.uCam[1][1], al, be);
        expect(shipShift(g, p, F.u)).toBeCloseTo(1 / Math.sqrt(1 - 2 / r), 10);
      }
    }
  });
  it('flat limit: Doppler and aberration of a moving observer', () => {
    const S = createSpacetime('kerr', { a: 0 });
    const r = 1e8, th = 1.0, g = S.gTracer(r, th);
    const F0 = staticFrame(g, S.gTracerInv(r, th));
    for (const v of [0.3, 0.8, 0.98]) {
      const Fv = boostFrame(F0, [v, 0, 0]);
      const { P } = cam(S, r, th, Fv);
      for (const [al, be] of [[0, 0], [0.5 * r, 0.2 * r], [r, r]]) {
        const p = rayMomentum(P.E, r, P.uCam[1][1], al, be);
        const thSeen = Math.atan(Math.hypot(al, be) / r);
        // direction of the same ray in the rest frame
        const E0 = innerProduct(g, p, F0.u);
        const thRest = Math.acos(innerProduct(g, p, F0.f) / E0);
        expect(aberrate(v, thRest)).toBeCloseTo(thSeen, 7);
        // E_moving / E_rest = gamma (1 + v cos th_rest); far away E_rest / E_inf = 1 + O(1/r)
        expect(shipShift(g, p, Fv.u)).toBeCloseTo(dopplerFlat(v, thRest), 6);
      }
    }
  });
});

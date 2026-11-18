// @ts-check
// Blackbody colours (plan 4.5, colour mode "blackbody"): the chromaticity of a Planck spectrum at temperature T, as
// linear sRGB normalised to luminance Y = 1, tabulated in log T for the display shader. Colour matching functions:
// the multi-lobe Gaussian fit of the CIE 1931 2-degree observer by Wyman, Sloan and Shirley (JCGT 2013). Colours outside
// the sRGB gamut (deep red, deep blue) are desaturated towards white until they fit.

export const BB_TMIN = 800, BB_TMAX = 60000, BB_N = 256;

/** @param {number} x @param {number} mu @param {number} s1 @param {number} s2 */
const lobe = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
/** CIE 1931 colour matching functions (fit), wavelength in nm @param {number} l */
export function cmf(l) {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}

/** Planck spectral radiance, arbitrary units, wavelength in nm @param {number} l @param {number} T */
const planck = (l, T) => { const lm = l * 1e-9; return 1 / (lm ** 5 * (Math.exp(1.4387769e-2 / (lm * T)) - 1)); };

/** linear sRGB of a blackbody at T, luminance 1 @param {number} T @returns {number[]} */
export function blackbodyRGB(T) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 2) {
    const [x, y, z] = cmf(l), p = planck(l, T);
    X += x * p; Y += y * p; Z += z * p;
  }
  X /= Y; Z /= Y; Y = 1;
  let rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
  const lum = (/** @type {number[]} */ c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const m = Math.min(...rgb);
  if (m < 0) rgb = rgb.map((c) => c - m);   // desaturate into the gamut
  const L = lum(rgb);
  return rgb.map((c) => c / L);
}

/** The table: BB_N RGBA float entries, uniform in log T from BB_TMIN to BB_TMAX. */
export function blackbodyTable() {
  const out = new Float32Array(4 * BB_N);
  for (let i = 0; i < BB_N; i++) {
    const T = Math.exp(Math.log(BB_TMIN) + (Math.log(BB_TMAX) - Math.log(BB_TMIN)) * i / (BB_N - 1));
    out.set([...blackbodyRGB(T), 1], 4 * i);
  }
  return out;
}

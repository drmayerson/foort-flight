// FOORT Flight display pass (G2): a record image of a direct trace -> the view seen by the observer.
//
// Disc emission as in FOORT-GPU's display.glsl (Johnson-SU envelope J, redshift power, fudge factor, noise with slow
// light, the binned tail), with two changes:
//  - every crossing's g (FOORT's g_inf, observer at infinity) is multiplied by the pixel's ship factor
//    s = E_ship / E_inf = 1 / p_t (js/physics/redshift.js), recomputed here from the camera uniforms exactly as the
//    tracer builds the ray;
//  - colour modes: 0 FOORT colour map (I = sum F (s g)^p J X, exposure, soft shoulder, afmhot), written display-ready;
//    1 blackbody (plan 4.5): each crossing emits a blackbody at T_em(r) = T0 (R / r_ref)^(-3/4) (R the envelope
//    radius), seen at T_obs = s g T_em with bolometric weight F (s g)^4 J X and the colour of a Planck spectrum at
//    T_obs (luminance-normalised table); HDR out, the tone pass exposes and maps it.
// Sky (escaped rays, direction (theta_end, phi_end + azimuth)): procedural stars with temperatures, shifted to s T and
// brightened by s^4 (no lensing magnification of point stars: plan 4.5), a faint glow band, or a picture.
// uView.w = 1 writes raw values for the tests: (s, I of mode 0 before exposure, termination code, steps).

uniform highp sampler2D uR0, uR1, uR2, uR3, uR4, uR5;
uniform ivec4 uImg;          // record width, height, 0, 0
uniform mat4 uE;             // camera (as the tracer)
uniform mat4 uG;
uniform vec4 uCam;           // r_c, delta_c, phi_c, x_c
uniform vec4 uScreen;        // centre alpha, beta; size alpha, beta
uniform ivec4 uView;         // colour mode, sky mode (0 none, 1 stars, 2 picture), tail on, raw output
uniform vec4 uEm;            // Johnson-SU mu, gamma, sigma; redshift power p
uniform vec4 uEm2;           // fudge factor, max passes (0: all), envelope radius (0 coordinate r, 1 circumferential), exposure (mode 0)
uniform vec4 uTail;          // log r of the first bin edge, 1 / bin width, bins, 0
uniform highp sampler3D uNoise;
uniform ivec4 uNoiseN;       // Nt, Nx, Nphi, noise on
uniform vec4 uNoiseP;        // sigma_n, T_over_M, xmin, xmax
uniform vec4 uNoiseFade;     // fade width, 0, 0, 0
uniform vec4 uTime;          // t_obs / M wrapped to [0, T), slow light (1/0), M, azimuth (rad) added to every phi
uniform highp sampler2D uFluidD;
uniform vec4 uFluidXD;       // xMin, dx, nodes, r0
uniform highp sampler2D uBB;  // blackbody chromaticity, uniform in log T
uniform vec4 uBBP;           // log Tmin, log Tmax, T0 (K), r_ref
uniform highp sampler2D uSky;
uniform vec4 uSkyP;          // picture brightness, picture half-width (rad), aspect w/h, star brightness
uniform vec4 uSkyCam;        // sin, cos of the picture frame's theta, pixel angle (rad), 0
out vec4 outColor;

const float PI = 3.14159265358979;

vec3 bb(float T) {
  float u = clamp((log(max(T, 1.0)) - uBBP.x) / (uBBP.y - uBBP.x), 0.0, 1.0);
  return texture(uBB, vec2(u * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
}

float envelopeR(float r) {
  if (uEm2.z < 0.5) return r;
  float f = clamp((log(r - uFluidXD.w) - uFluidXD.x) / uFluidXD.y, 0.0, uFluidXD.z - 1.0);
  int i = min(int(floor(f)), int(uFluidXD.z) - 2);
  return mix(texelFetch(uFluidD, ivec2(i, 0), 0).w, texelFetch(uFluidD, ivec2(i + 1, 0), 0).w, f - float(i));
}
float johnsonSU(float rr) {
  float r = envelopeR(rr);
  float d = r - uEm.x, t = uEm.y + asinh(d / uEm.z);
  return exp(-0.5 * t * t) / sqrt(d * d + uEm.z * uEm.z);
}
float noiseX(float tau, float x, float phi) {
  vec3 n = vec3(uNoiseN.zyx);
  vec3 uvw = vec3(phi / (2.0 * PI) + 0.5 / n.x, ((x - uNoiseP.z) / (uNoiseP.w - uNoiseP.z) * (n.y - 1.0) + 0.5) / n.y, tau / uNoiseP.y + 0.5 / n.z);
  return texture(uNoise, uvw).r;
}
float noiseCover(float x) {
  float d = max(uNoiseP.z - x, x - uNoiseP.w);
  return d <= 0.0 ? 1.0 : clamp(1.0 - d / max(uNoiseFade.x, 1e-6), 0.0, 1.0);
}
float noiseFactor(vec4 c) {
  if (uNoiseN.w == 0 || uNoiseP.x == 0.0) return 1.0;
  float M = uTime.z;
  float tau = uTime.x + (uTime.y > 0.5 ? c.z / M : 0.0);
  float x = log(c.x / M);
  float sg = uNoiseP.x * noiseCover(x);
  return exp(sg * noiseX(tau, x, c.y + uTime.w) - 0.5 * sg * sg);
}
float passWeight(int k) {
  if (uEm2.y > 0.0 && float(k + 1) > uEm2.y) return 0.0;
  return k == 0 ? 1.0 : uEm2.x;
}
float temperature(float r) { return uBBP.z * pow(max(envelopeR(r), 1e-9) / uBBP.w, -0.75); }

// mode 0: one crossing, FOORT's intensity with the ship factor
float crossI(vec4 c, int k, float s) {
  if (!(c.x > 0.0) || !(c.w > 0.0)) return 0.0;
  return passWeight(k) * pow(s * c.w, uEm.w) * johnsonSU(c.x) * noiseFactor(c);
}
// mode 1: one crossing as a blackbody
vec3 crossBB(vec4 c, int k, float s) {
  if (!(c.x > 0.0) || !(c.w > 0.0)) return vec3(0.0);
  float g = s * c.w;
  return passWeight(k) * g * g * g * g * johnsonSU(c.x) * noiseFactor(c) * bb(g * temperature(c.x));
}
// the binned tail: W_b = sum F g^p over crossings 4, 5, ... (weighted at trace time; no noise, no slow light)
float tailW(float v, out float rb, int b) {
  uint bits = floatBitsToUint(v);
  float W = uintBitsToFloat(bits & 0xFFFFFF00u);
  rb = exp(uTail.x + (float(b) + float(bits & 0xFFu) / 255.0) / uTail.y);
  return W > 0.0 ? W : 0.0;
}
vec3 tail(ivec2 q, float s, bool blackbody) {
  if (uView.z == 0) return vec3(0.0);
  vec4 a = texelFetch(uR4, q, 0), c = texelFetch(uR5, q, 0);
  vec3 sum = vec3(0.0);
  for (int b = 0; b < 8; b++) {
    float v = b < 4 ? a[b] : c[b - 4], rb;
    float W = tailW(v, rb, b);
    if (W <= 0.0) continue;
    // the tail keeps no per-crossing g: mode 1 uses s^4 W and the colour of T_em s (an approximation for the
    // light trapped near the photon ring or in the cap)
    if (blackbody) sum += W * pow(s, 4.0) * johnsonSU(rb) * bb(s * temperature(rb));
    else sum += vec3(W * pow(s, uEm.w) * johnsonSU(rb));
  }
  return sum;
}

float hash1(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec4 hash4(vec3 p) { return vec4(hash1(p), hash1(p + 13.1), hash1(p + 27.7), hash1(p + 41.3)); }

// procedural stars on the sphere: three layers of cells on a cube; one star at most per cell
vec3 stars(vec3 d, float s) {
  vec3 a = abs(d);
  vec2 uv; float face; float m;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; m = a.x; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; m = a.y; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; m = a.z; }
  float sig = max(uSkyCam.z, 4e-4);            // star radius ~ a pixel
  vec3 col = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float K = 24.0 * pow(3.0, float(L));
    vec2 cell = floor((uv * 0.5 + 0.5) * K);
    vec4 h = hash4(vec3(cell, face * 3.0 + float(L)));
    if (h.x > 0.3) continue;
    vec2 p = ((cell + 0.2 + 0.6 * h.yz) / K) * 2.0 - 1.0;
    float dist = length(uv - p) * m * m;        // ~ angle on the sphere (gnomonic)
    float flux = pow(h.w, 8.0) * pow(0.25, float(L)) + 0.002;
    float T = 2600.0 + 26000.0 * pow(hash1(vec3(cell, face + 91.0)), 3.0);
    col += flux * exp(-0.5 * dist * dist / (sig * sig)) * bb(s * T);
  }
  // a faint glow band (a galaxy seen edge-on), 5000 K
  vec3 n = normalize(vec3(0.3, 0.5, 0.81));
  float band = exp(-pow(dot(d, n), 2.0) / 0.02) * (0.6 + 0.4 * hash1(floor(d * 40.0)));
  col += 0.004 * band * bb(5000.0 * s);
  return col * pow(s, 4.0);
}
vec3 picture(vec3 d, float s) {
  vec2 n = vec2(d.y, -uSkyCam.y * d.x + uSkyCam.x * d.z);
  vec2 uv = 0.5 + vec2(n.x, n.y * uSkyP.z) / (2.0 * uSkyP.y);
  uv = 1.0 - abs(mod(uv, 2.0) - 1.0);
  vec3 c = texture(uSky, uv).rgb;
  c = pow(c, vec3(2.2));                        // sRGB picture -> linear
  return uSkyP.x * c * pow(s, 4.0) * bb(6500.0 * s) / bb(6500.0);   // approximate colour shift (plan 4.5)
}

float softShoulder(float v) { float s = sqrt(v); return s < 0.7 ? s : 0.7 + 0.3 * (1.0 - exp(-(s - 0.7) / 0.3)); }
vec3 afmhot(float t) { t = clamp(t, 0.0, 1.0); return clamp(vec3(2.0 * t, 2.0 * t - 0.5, 2.0 * t - 1.0), 0.0, 1.0); }

void main() {
  vec2 fr = gl_FragCoord.xy / vec2(textureSize(uR0, 0)) * vec2(uImg.xy);   // the record pixel of this target pixel
  ivec2 q = clamp(ivec2(fr), ivec2(0), uImg.xy - 1);
  vec4 r0 = texelFetch(uR0, q, 0);
  // the pixel's ray as the tracer built it: p = uE pflat, s = 1 / p_t (the tracer then normalises p_t to 1)
  vec2 unit = (vec2(q) + 0.5) / vec2(uImg.xy);
  float alpha = uScreen.x + uScreen.z * (unit.x - 0.5), beta = uScreen.y + uScreen.w * (unit.y - 0.5);
  float rc = uCam.x, D = sqrt(rc * rc + alpha * alpha + beta * beta);
  vec4 pflat = vec4(-1.0, -rc / D, -beta / rc / D, alpha / rc / sin(uCam.y) / D);
  float s = 1.0 / (uG * (uE * pflat)).x;
  if (r0.y <= 0.0) { outColor = uView.w == 1 ? vec4(s, 0.0, -1.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0); return; }
  int code = int(r0.x + 0.5) % 16;
  vec4 c1 = texelFetch(uR1, q, 0), c2 = texelFetch(uR2, q, 0), c3 = texelFetch(uR3, q, 0);
  bool bbMode = uView.x == 1;
  float I = crossI(c1, 0, s) + crossI(c2, 1, s) + crossI(c3, 2, s) + tail(q, s, false).x;
  if (uView.w == 1) { outColor = vec4(s, I, float(code), r0.y); return; }
  vec3 sky = vec3(0.0);
  if (code == 2 && uView.y > 0) {
    float th = r0.z, ph = r0.w + uTime.w;
    vec3 d = vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th));
    sky = uView.y == 1 ? uSkyP.w * stars(d, s) : picture(d, s);
  }
  if (bbMode) {
    vec3 disc = crossBB(c1, 0, s) + crossBB(c2, 1, s) + crossBB(c3, 2, s) + tail(q, s, true);
    outColor = vec4(disc + sky, 1.0);
  } else {
    float v = softShoulder(max(I * uEm2.w, 0.0));
    vec3 c = afmhot(v);
    // the sky is linear; the colour-map image is display-referred: map the sky with a gentle curve before adding
    c += (vec3(1.0) - exp(-sky * 4.0)) * (1.0 - clamp(v, 0.0, 1.0));
    outColor = vec4(c, 1.0);
  }
}

// FOORT Flight cubemap display (G3, plan 5.2): the view of the ship from a cubemap of records traced for a reference
// observer. Shading in shade.glsl (prepended by js/gl/display.js).
//
// Per screen pixel:
//  1. the look direction d in the ship frame (pinhole: (1, x tan(fov_x/2), y tan(fov_y/2)) in (f, right, up));
//  2. its past-directed momentum p = (-1, d) in the ship frame's components -> the reference frame's: uM (ship frame ->
//     local ZAMO frame -> the reference ZAMO frame at the cubemap's (r, theta) -> the boosted reference frame;
//     js/physics/refFrame.js). Exact when the ship is at the reference (r, theta): t and phi are symmetries, applied
//     as the time t_ship and the azimuth phi_ship - phi_ref (uTime.w);
//  3. the reference direction picks a face and texel; the emission of the 4 nearest texels is blended (records are
//     never blended: crossings jump across lensing boundaries);
//  4. the ship factor of the pixel's own ray: s = E_ship / E_inf = 1 / (E_ref p_t) with p_t from uRefT.
// Stars: when the 4 texels escaped in nearby directions, their directions are interpolated and the star field is
// evaluated once (sharp stars); otherwise their sky colours are blended.
// Atlas: face k at ((k mod 3) N, (k div 3) N); faces front, back, right, left, up, down of the reference frame.
// uView.w = 1 writes raw values: (I of mode 0, s, theta_esc or -1, phi_esc).

uniform ivec4 uAtlas;   // face size N, atlas width, atlas height, 0
uniform vec4 uShip;     // tan(fov_x / 2), tan(fov_y / 2), cos of the star-interpolation angle limit, 0
uniform mat4 uM;        // ship-frame components (t, f, right, up) -> reference-frame components
uniform vec4 uRefT;     // (-u_t, f_t, right_t, up_t) of the reference frame: p_t = dot((1, d), uRefT)
uniform vec4 uDst;      // viewport x, y, w, h

struct Tx { float I; vec3 bb; bool esc; vec3 dir; bool ok; };

Tx shadeTexel(ivec2 q, float s) {
  Tx t; t.I = 0.0; t.bb = vec3(0.0); t.esc = false; t.dir = vec3(0.0, 0.0, 1.0); t.ok = false;
  vec4 r0 = texelFetch(uR0, q, 0);
  if (r0.y <= 0.0) return t;
  t.ok = true;
  int code = int(r0.x + 0.5) % 16;
  vec4 c1 = texelFetch(uR1, q, 0), c2 = texelFetch(uR2, q, 0), c3 = texelFetch(uR3, q, 0);
  if (uView.x == 1) t.bb = crossBB(c1, 0, s) + crossBB(c2, 1, s) + crossBB(c3, 2, s) + tail(q, s, true);
  t.I = crossI(c1, 0, s) + crossI(c2, 1, s) + crossI(c3, 2, s) + tail(q, s, false).x;
  if (code == 2) {
    t.esc = true;
    float th = r0.z, ph = r0.w + uTime.w;
    t.dir = vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th));
  }
  return t;
}

vec3 skyAt(vec3 d, float s) { return uView.y == 1 ? uSkyP.w * stars(d, s) : uView.y == 2 ? picture(d, s) : vec3(0.0); }

void main() {
  vec2 ndc = (gl_FragCoord.xy - uDst.xy) / uDst.zw * 2.0 - 1.0;
  vec3 dS = normalize(vec3(1.0, ndc.x * uShip.x, ndc.y * uShip.y));
  vec4 pr = uM * vec4(-1.0, dS);
  float Er = -pr.x;
  vec3 d = pr.yzw / Er;   // unit (f, right, up) in the reference frame
  float s = 1.0 / (Er * dot(vec4(1.0, d), uRefT));

  // face and in-face coordinates
  vec3 a = abs(d);
  int face; float fa, ra, ua;   // components along the face's f', right', up'
  if (a.x >= a.y && a.x >= a.z) { if (d.x > 0.0) { face = 0; fa = d.x; ra = d.y; ua = d.z; } else { face = 1; fa = -d.x; ra = -d.y; ua = d.z; } }
  else if (a.y >= a.z) { if (d.y > 0.0) { face = 2; fa = d.y; ra = -d.x; ua = d.z; } else { face = 3; fa = -d.y; ra = d.x; ua = d.z; } }
  else { if (d.z > 0.0) { face = 4; fa = d.z; ra = d.y; ua = -d.x; } else { face = 5; fa = -d.z; ra = d.y; ua = d.x; } }
  float N = float(uAtlas.x);
  vec2 xy = (vec2(ra, ua) / fa * 0.5 + 0.5) * N - 0.5;    // texel-centre coordinates in the face
  xy = clamp(xy, vec2(0.0), vec2(N - 1.0001));
  vec2 i0 = min(floor(xy), vec2(N - 2.0));
  vec2 f = xy - i0;
  ivec2 o = ivec2((face % 3) * uAtlas.x, (face / 3) * uAtlas.x) + ivec2(i0);
  Tx t00 = shadeTexel(o, s), t10 = shadeTexel(o + ivec2(1, 0), s), t01 = shadeTexel(o + ivec2(0, 1), s), t11 = shadeTexel(o + ivec2(1, 1), s);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  // untraced texels (a cubemap still being refined) do not count
  vec4 ok = vec4(t00.ok, t10.ok, t01.ok, t11.ok);
  float wsum = dot(w, ok);
  if (wsum <= 0.0) { outColor = uView.w == 1 ? vec4(0.0, s, -2.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0); return; }
  w = w * ok / wsum;
  float I = w.x * t00.I + w.y * t10.I + w.z * t01.I + w.w * t11.I;
  vec3 bbc = w.x * t00.bb + w.y * t10.bb + w.z * t01.bb + w.w * t11.bb;
  // sky: interpolate escape directions where they agree, else blend colours
  bool allEsc = t00.esc && t10.esc && t01.esc && t11.esc;
  vec3 sky = vec3(0.0);
  vec3 dEsc = vec3(0.0);
  bool interp = allEsc && min(min(dot(t00.dir, t10.dir), dot(t00.dir, t01.dir)), dot(t00.dir, t11.dir)) > uShip.z;
  if (interp) {
    dEsc = normalize(w.x * t00.dir + w.y * t10.dir + w.z * t01.dir + w.w * t11.dir);
    if (uView.y > 0) sky = skyAt(dEsc, s);
  } else if (uView.y > 0) {
    if (t00.esc) sky += w.x * skyAt(t00.dir, s);
    if (t10.esc) sky += w.y * skyAt(t10.dir, s);
    if (t01.esc) sky += w.z * skyAt(t01.dir, s);
    if (t11.esc) sky += w.w * skyAt(t11.dir, s);
  }
  if (uView.w == 1) {
    outColor = interp ? vec4(I, s, acos(clamp(dEsc.z, -1.0, 1.0)), atan(dEsc.y, dEsc.x)) : vec4(I, s, -1.0, 0.0);
    return;
  }
  if (uView.x == 1) outColor = vec4(bbc + sky, 1.0);
  else {
    float v = softShoulder(max(I * uEm2.w, 0.0));
    vec3 c = afmhot(v) + (vec3(1.0) - exp(-sky * 4.0)) * (1.0 - clamp(v, 0.0, 1.0));
    outColor = vec4(c, 1.0);
  }
}

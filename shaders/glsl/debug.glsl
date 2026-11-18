// FOORT Flight debug display (G1): draws a record target to the canvas.
// Modes: 0 four-colour screen (escape direction, FOORT's FourColorScreen; the azimuth uAz turns it, an exact symmetry),
//        1 redshift g of the first disc crossing, 2 steps, 3 termination.
// Pixels not traced yet (steps = 0) are dark grey. Records: rec0 = (termCode + 16 passes, steps, theta_end, phi_end),
// rec1 = first crossing (r, phi, dt, g).
uniform highp sampler2D uRec0;
uniform highp sampler2D uRec1;
uniform ivec4 uView;   // mode, record width, record height, 0
uniform vec4 uAux;     // azimuth offset (rad), steps scale, 0, 0
uniform vec4 uDst;     // destination viewport x, y, w, h (pixels)
out vec4 outColor;

const float PI = 3.14159265358979;
const vec3 Q1 = vec3(228.0, 74.0, 64.0) / 255.0, Q2 = vec3(64.0, 156.0, 228.0) / 255.0;
const vec3 Q3 = vec3(240.0, 200.0, 60.0) / 255.0, Q4 = vec3(90.0, 190.0, 110.0) / 255.0;

vec3 termColor(int code) {
  if (code == 1) return vec3(0.0);
  if (code == 2) return vec3(0.55, 0.75, 0.95);
  if (code == 3) return vec3(0.95, 0.55, 0.15);
  if (code == 4) return vec3(1.0, 0.0, 1.0);
  if (code == 6) return vec3(0.7, 0.05, 0.05);
  return vec3(0.3);
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(smoothstep(0.3, 0.9, t), smoothstep(0.0, 0.6, t) * (1.0 - 0.5 * t), smoothstep(0.6, 0.0, t) + 0.2 * t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uDst.xy) / uDst.zw;
  ivec2 ij = clamp(ivec2(uv * vec2(uView.yz)), ivec2(0), uView.yz - 1);
  vec4 r0 = texelFetch(uRec0, ij, 0);
  if (r0.y <= 0.0) { outColor = vec4(0.12, 0.12, 0.14, 1.0); return; }
  int code = int(r0.x + 0.5) % 16;
  vec3 c;
  if (uView.x == 0) {
    if (code == 2) {
      float ph = mod(r0.w + uAux.x, 2.0 * PI);
      c = r0.z < 0.5 * PI ? (ph < PI ? Q1 : Q2) : (ph < PI ? Q3 : Q4);
    } else c = termColor(code);
  } else if (uView.x == 1) {
    vec4 cr = texelFetch(uRec1, ij, 0);
    c = cr.x > 0.0 ? ramp(cr.w / 1.5) : (code == 1 ? vec3(0.0) : vec3(0.05, 0.05, 0.1));
  } else if (uView.x == 2) {
    c = ramp(log(r0.y) / log(uAux.y));
  } else c = termColor(code);
  outColor = vec4(c, 1.0);
}

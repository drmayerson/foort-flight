// FOORT Flight tone pass (G2): the display target -> the canvas.
// Mode 1 (HDR, blackbody colours): exposure (auto-exposure from the image's mean luminance, js/gl/display.js), ACES
// filmic curve (Narkowicz's fit), sRGB encoding. Mode 0: the colour-map image is display-ready; copied.
uniform highp sampler2D uSrc;
uniform vec4 uTone;   // mode (0 copy, 1 filmic), exposure, 0, 0
uniform vec4 uDst;    // destination viewport x, y, w, h
out vec4 outColor;

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 uv = (gl_FragCoord.xy - uDst.xy) / uDst.zw;
  vec3 c = texture(uSrc, uv).rgb;
  if (uTone.x > 0.5) c = srgb(aces(c * uTone.y));
  outColor = vec4(c, 1.0);
}

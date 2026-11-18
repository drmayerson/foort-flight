// FOORT Flight display pass (G2): a record image of a direct trace -> the view seen by the observer. Shading in
// shade.glsl (prepended by js/gl/display.js). uView.w = 1 writes raw values for the tests: (s, I of mode 0 before
// exposure, termination code, steps).
uniform ivec4 uImg;          // record width, height, 0, 0
uniform mat4 uE;             // camera (as the tracer)
uniform mat4 uG;
uniform vec4 uCam;           // r_c, delta_c, phi_c, x_c
uniform vec4 uScreen;        // centre alpha, beta; size alpha, beta

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

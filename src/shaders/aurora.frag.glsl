precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMotion; // 0..1

// ---- Noise helpers ----
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.55;
  mat2 m = rot(0.6) * mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++){
    v += a * valueNoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// domain warping for organic motion
vec2 warp(vec2 p, float t){
  float n1 = fbm(p + vec2(0.0, t));
  float n2 = fbm(p * 1.3 - vec2(t * 0.8, t * 0.4));
  return p + vec2(n1, n2) * 0.75;
}

// cinematic palette
vec3 palette(float x){
  vec3 deep = vec3(0.03, 0.05, 0.09);
  vec3 blue = vec3(0.10, 0.22, 0.45);
  vec3 cyan = vec3(0.16, 0.75, 0.85);
  vec3 vio  = vec3(0.70, 0.35, 0.95);
  vec3 col = mix(deep, blue, smoothstep(0.05, 0.55, x));
  col = mix(col, cyan, smoothstep(0.35, 0.90, x));
  col = mix(col, vio,  smoothstep(0.70, 1.00, x));
  return col;
}

// ACES tonemap (approx)
vec3 acesTonemap(vec3 x){
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x*(a*x + b)) / (x*(c*x + d) + e), 0.0, 1.0);
}

// sRGB encode
vec3 toSRGB(vec3 c){
  return pow(c, vec3(1.0/2.2));
}

// better grain (interleaved gradient noise)
float ign(vec2 uv){
  // interleaved gradient noise
  return fract(52.9829189 * fract(0.06711056 * uv.x + 0.00583715 * uv.y));
}

void main(){
  vec2 uv = vUv;

  // aspect-correct space
  vec2 p = (uv * uResolution - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // subtle parallax from mouse
  vec2 m = (uMouse / uResolution) - 0.5;
  p += m * 0.12;

  float t = uTime * 0.18 * uMotion;

  // base background gradient
  float bg = smoothstep(-0.8, 0.8, p.y);
  vec3 col = mix(vec3(0.02,0.03,0.06), vec3(0.04,0.06,0.10), bg);

  // organic aurora field (domain-warped fbm)
  vec2 pw = warp(p * 1.15, t);
  float f1 = fbm(pw * 1.4 + vec2(0.0, t));
  float f2 = fbm(pw * 2.0 - vec2(t*1.1, t*0.7));

  // aurora bands
  float bands = fbm(vec2(pw.x * 1.2, pw.y * 3.4) + vec2(t, -t));
  bands = smoothstep(0.35, 0.95, bands);

  float field = (f1 * 0.60 + f2 * 0.40);
  field = mix(field, field + bands * 0.45, 0.65);

  // intensity shaping (more “HDR-like”)
  float core = smoothstep(0.35, 0.95, field);
  float glow = pow(max(core, 0.0), 2.8);

  vec3 aur = palette(core) * (0.65 + 1.2 * glow);
  col += aur * 0.95;

  // vignette (cinematic)
  float r = length(p);
  float vig = smoothstep(1.25, 0.15, r);
  col *= (0.65 + 0.55 * vig);

  // subtle chroma split near edges (fake CA)
  float ca = (1.0 - vig) * 0.0035;
  col.r += ca;
  col.b -= ca;

  // film grain + temporal dither (reduces banding)
  float g = ign(uv * uResolution.xy + fract(uTime)) - 0.5;
  col += g * 0.035;

  // very subtle scanline texture
  col *= 1.0 - 0.015 * sin((uv.y * uResolution.y) * 3.14159);

  // tonemap + output
  col = acesTonemap(col);
  col = toSRGB(col);

  gl_FragColor = vec4(col, 1.0);
}

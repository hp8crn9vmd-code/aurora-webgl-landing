precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMotion; // 0..1

// hash/noise
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
}

mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.55;
  mat2 m = rot(0.5) * mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<6;i++){
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// ACES-ish tonemap
vec3 acesTonemap(vec3 x){
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x*(a*x + b)) / (x*(c*x + d) + e), 0.0, 1.0);
}

float ign(vec2 uv){
  return fract(52.9829189 * fract(0.06711056 * uv.x + 0.00583715 * uv.y));
}

void main(){
  vec2 uv = vUv;

  // aspect-correct coords
  vec2 p = (uv * uResolution - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // VERY subtle parallax (not object-like)
  vec2 m = (uMouse / uResolution) - 0.5;
  p += m * 0.03;

  float t = uTime * 0.08 * max(uMotion, 0.0); // slow motion

  // Flow field (soft, no bands/objects)
  vec2 q = p;
  q += vec2(
    fbm(p * 0.45 + vec2( 0.0,  t)),
    fbm(p * 0.45 + vec2( t,  0.0))
  ) * 0.35;

  // Second warp for extra smoothness
  vec2 r = q;
  r += vec2(
    fbm(q * 0.70 - vec2(t * 0.7, t * 0.2)),
    fbm(q * 0.70 + vec2(t * 0.2, t * 0.7))
  ) * 0.25;

  float n = fbm(r * 1.05);

  // Premium palette (no aurora look)
  vec3 c0 = vec3(0.02, 0.03, 0.06); // deep navy
  vec3 c1 = vec3(0.07, 0.10, 0.16); // slate
  vec3 c2 = vec3(0.10, 0.20, 0.24); // teal-gray
  vec3 c3 = vec3(0.20, 0.12, 0.26); // muted purple

  // Smooth mesh-like mixing
  float w1 = smoothstep(0.15, 0.60, n);
  float w2 = smoothstep(0.40, 0.85, n);
  vec3 col = mix(c0, c1, w1);
  col = mix(col, c2, w2);

  // Add a gentle vertical studio light
  float light = smoothstep(-0.8, 0.9, p.y) * 0.25;
  col += vec3(0.06, 0.08, 0.10) * light;

  // Subtle “lens warmth” in one corner (still not an object)
  float corner = smoothstep(1.2, 0.0, length(p - vec2(0.55, 0.35)));
  col = mix(col, col + c3 * 0.35, corner * 0.65);

  // Cinematic vignette
  float vig = smoothstep(1.25, 0.15, length(p));
  col *= (0.70 + 0.55 * vig);

  // Film grain + temporal dither (reduces banding)
  float g = ign(uv * uResolution.xy + fract(uTime)) - 0.5;
  col += g * 0.030;

  // Tonemap + gamma to sRGB-ish output
  col = acesTonemap(col);
  col = pow(col, vec3(1.0/2.2));

  gl_FragColor = vec4(col, 1.0);
}

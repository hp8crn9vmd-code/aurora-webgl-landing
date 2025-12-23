precision highp float;

varying vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;
uniform vec2  uMouse;
uniform float uMotion;
uniform vec2  uPoints[5]; // خمسة مكونات (مراكز تأثير) تتفاعل في JS

// noise
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
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.55;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<5;i++){
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// palette (deep/cinematic)
vec3 palette(float t){
  vec3 a = vec3(0.03, 0.05, 0.10);
  vec3 b = vec3(0.08, 0.18, 0.35);
  vec3 c = vec3(0.14, 0.55, 0.75);
  vec3 d = vec3(0.55, 0.30, 0.85);
  vec3 col = mix(a, b, smoothstep(0.0, 0.55, t));
  col = mix(col, c, smoothstep(0.35, 0.90, t));
  col = mix(col, d, smoothstep(0.70, 1.00, t));
  return col;
}

// ACES-ish tonemap
vec3 acesTonemap(vec3 x){
  const float A = 2.51;
  const float B = 0.03;
  const float C = 2.43;
  const float D = 0.59;
  const float E = 0.14;
  return clamp((x*(A*x + B)) / (x*(C*x + D) + E), 0.0, 1.0);
}

float ign(vec2 uv){
  return fract(52.9829189 * fract(0.06711056 * uv.x + 0.00583715 * uv.y));
}

void main(){
  vec2 uv = vUv;
  vec2 p  = (uv * uResolution - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // parallax very subtle
  vec2 m = (uMouse / uResolution) - 0.5;
  p += m * 0.06;

  float t = uTime * 0.12 * uMotion;

  // base smooth field from 5 interacting components
  float field = 0.0;
  for(int i=0;i<5;i++){
    float d = length(p - uPoints[i]);
    field += exp(-d * 2.4); // gaussian influence
  }
  field = field / 2.2;

  // gentle fluid-ish modulation (still not "objects")
  float n = fbm(p * 1.25 + vec2(t * 0.35, -t * 0.25));
  field = mix(field, field + n * 0.35, 0.55);

  // shape to cinematic contrast
  float core = smoothstep(0.15, 0.95, field);
  float glow = pow(core, 2.6);

  vec3 col = palette(core) * (0.55 + 1.2 * glow);

  // vignette
  float vig = smoothstep(1.25, 0.20, length(p));
  col *= (0.70 + 0.55 * vig);

  // grain + dithering
  float g = ign(uv * uResolution.xy + fract(uTime)) - 0.5;
  col += g * 0.028;

  // tonemap + gamma
  col = acesTonemap(col);
  col = pow(col, vec3(1.0/2.2));

  gl_FragColor = vec4(col, 1.0);
}

precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
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

vec3 palette(float t){
  vec3 a = vec3(0.06, 0.09, 0.16);
  vec3 b = vec3(0.18, 0.24, 0.40);
  vec3 c = vec3(0.25, 0.65, 0.85);
  vec3 d = vec3(0.62, 0.35, 0.88);
  vec3 col = mix(a, b, smoothstep(0.0, 0.55, t));
  col = mix(col, c, smoothstep(0.35, 0.85, t));
  col = mix(col, d, smoothstep(0.70, 1.00, t));
  return col;
}

void main(){
  vec2 uv = vUv;

  vec2 p = (uv * uResolution - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // تفاعل لطيف مع الماوس
  vec2 m = (uMouse / uResolution) - 0.5;
  p += m * 0.15;

  float t = uTime * 0.12;

  float n1 = fbm(p * 1.25 + vec2(0.0, t));
  float n2 = fbm(p * 2.15 - vec2(t * 1.3, t * 0.7));
  float n3 = fbm(p * 0.85 + vec2(t * 0.6, -t * 1.1));

  float field = (n1 * 0.55 + n2 * 0.30 + n3 * 0.25);

  // aurora bands
  float bands = smoothstep(0.25, 0.95, fbm(vec2(p.x * 1.2, p.y * 3.2) + vec2(t, -t)));
  field = mix(field, field + bands * 0.35, 0.55);

  float glow = pow(max(field, 0.0), 2.2);
  vec3 col = palette(field);
  col += vec3(0.10, 0.18, 0.28) * glow;

  // vignette
  float r = length(p);
  float vig = smoothstep(1.15, 0.25, r);
  col *= vig;

  // film grain
  float g = hash(uv * (uResolution.xy * 0.75) + fract(uTime)) - 0.5;
  col += g * 0.035;

  col = pow(col, vec3(0.95));
  col = clamp(col, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}

precision highp float;

varying vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;
uniform vec2  uMouse;
uniform float uMotion; // 0..1

// ---- Hash / Noise (vec3) ----
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0 - 2.0*f);

  float n000 = hash13(i + vec3(0,0,0));
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);

  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);

  return mix(nxy0, nxy1, f.z);
}

float fbm3(vec3 p){
  float v = 0.0;
  float a = 0.55;
  for(int i=0;i<5;i++){
    v += a * noise3(p);
    p = p * 2.02 + vec3(17.0, 11.0, 5.0);
    a *= 0.5;
  }
  return v;
}

// ---- Tonemap / Output ----
vec3 acesTonemap(vec3 x){
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x*(a*x + b)) / (x*(c*x + d) + e), 0.0, 1.0);
}

float ign(vec2 uv){
  // interleaved gradient noise for dithering
  return fract(52.9829189 * fract(0.06711056 * uv.x + 0.00583715 * uv.y));
}

// ---- Volumetric field ----
float densityField(vec3 p, float t){
  // “Fog volume” with slow evolution (no object motion)
  float d = fbm3(p * 0.85 + vec3(0.0, 0.0, t));
  d = smoothstep(0.45, 0.82, d);
  return d;
}

void main(){
  vec2 uv = vUv;
  vec2 p = (uv * uResolution - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // camera setup (subtle mouse rotation, still volumetric)
  vec2 m = (uMouse / uResolution) - 0.5;
  float yaw   = m.x * 0.35;
  float pitch = m.y * 0.25;

  float t = uTime * 0.10 * uMotion; // very slow

  // Ray origin & direction in a simple camera space
  vec3 ro = vec3(0.0, 0.0, -2.8);
  vec3 rd = normalize(vec3(p.x, p.y, 1.6));

  // Apply yaw/pitch
  float cy = cos(yaw),  sy = sin(yaw);
  float cp = cos(pitch),sp = sin(pitch);
  mat3 Ry = mat3(cy,0.0,sy,  0.0,1.0,0.0,  -sy,0.0,cy);
  mat3 Rx = mat3(1.0,0.0,0.0,  0.0,cp,-sp,  0.0,sp,cp);
  rd = Ry * Rx * rd;

  // Lighting direction
  vec3 lightDir = normalize(vec3(0.6, 0.4, 0.7));

  // Volumetric raymarch
  vec3 col = vec3(0.0);
  float trans = 1.0;

  // Background base
  vec3 bgA = vec3(0.02, 0.03, 0.06);
  vec3 bgB = vec3(0.04, 0.06, 0.10);
  col += mix(bgA, bgB, smoothstep(-0.7, 0.9, p.y)) * 0.35;

  float stepSize = 0.08;
  float maxDist = 5.0;
  float dist = 0.0;

  for(int i=0;i<56;i++){
    if(dist > maxDist || trans < 0.02) break;

    vec3 pos = ro + rd * dist;

    // Move volume slowly in Z for “breathing” depth (not objects)
    vec3 q = pos + vec3(0.0, 0.0, t * 0.8);

    float d = densityField(q, t);

    // soft falloff to keep center richer
    float fall = smoothstep(3.8, 0.6, length(pos));
    d *= fall;

    // fake single scattering
    float ndl = clamp(dot(lightDir, rd) * 0.5 + 0.5, 0.0, 1.0);
    vec3 fogColor = mix(vec3(0.07, 0.12, 0.22), vec3(0.12, 0.30, 0.40), ndl);

    float alpha = d * 0.12;          // absorption
    vec3  emit  = fogColor * (d * (0.35 + 0.65 * ndl));

    col += trans * emit;
    trans *= (1.0 - alpha);

    dist += stepSize;
  }

  // Vignette (cinematic)
  float vig = smoothstep(1.25, 0.20, length(p));
  col *= (0.70 + 0.55 * vig);

  // Dither/grain to reduce banding
  float g = ign(uv * uResolution.xy + fract(uTime)) - 0.5;
  col += g * 0.025;

  // Tonemap + gamma
  col = acesTonemap(col);
  col = pow(col, vec3(1.0/2.2));

  gl_FragColor = vec4(col, 1.0);
}

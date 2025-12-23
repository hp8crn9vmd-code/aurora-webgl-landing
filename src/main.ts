import "./styles.css";
import * as THREE from "three";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

const CONFIG = {
  reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  grid: { size: 14, gap: 10, alpha: 0.018, sparkleAlpha: 0.012 },
  dprMax: 2,
  physics: {
    enabled: true,
    startDelayMs: 250,
    // base count is adaptive (see adapt())
    count: 22,
    restitution: 0.92,
    frictionAir: 0.012,
    density: 0.001,
    constraintRatio: 0.22,
    trails: true,
    trailFade: 0.14,
    turbulence: 0.000038,
    impulseChance: 0.01,
    impulseStrength: 0.00045,
    mouseForce: 0.00006,
    mouseRadius: 220,
  },
} as const;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// smooth noise for subtle textures/forces
function sCurve(x: number) { return x * x * (3 - 2 * x); }
function hash(n: number) { return (Math.sin(n) * 43758.5453123) % 1; }
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash(xi * 127.1 + yi * 311.7);
  const b = hash((xi + 1) * 127.1 + yi * 311.7);
  const c = hash(xi * 127.1 + (yi + 1) * 311.7);
  const d = hash((xi + 1) * 127.1 + (yi + 1) * 311.7);
  const u = sCurve(xf), v = sCurve(yf);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

// -------------------- Layer 1: WebGL --------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setClearColor(0x05070b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const layer1 = renderer.domElement;
layer1.id = "layer1";
layer1.className = "bg-layer";
layer1.setAttribute("aria-hidden", "true");
document.body.appendChild(layer1);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

type Comp = { pos: THREE.Vector2; vel: THREE.Vector2 };
const comps: Comp[] = Array.from({ length: 5 }, (_, i) => ({
  pos: new THREE.Vector2((i - 2) * 0.35, (Math.random() - 0.5) * 0.35),
  vel: new THREE.Vector2((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04),
}));

const points = Array.from({ length: 5 }, () => new THREE.Vector2());
const uniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uMouse: { value: new THREE.Vector2(0, 0) },
  uMotion: { value: CONFIG.reducedMotion ? 0.0 : 1.0 },
  uPoints: { value: points },
};

const material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

function stepComponents(dt: number) {
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const minX = -aspect * 0.95, maxX = aspect * 0.95;
  const minY = -0.95, maxY = 0.95;

  const kRep = 0.55;
  const kAtt = 0.14;
  const damp = 0.992;
  const t = performance.now() * 0.001;

  for (let i = 0; i < comps.length; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < comps.length; j++) {
      if (i === j) continue;
      const dx = comps[i].pos.x - comps[j].pos.x;
      const dy = comps[i].pos.y - comps[j].pos.y;
      const d2 = dx * dx + dy * dy + 0.0015;
      const d = Math.sqrt(d2);
      const rep = kRep / d2;
      const att = kAtt * (d - 0.62);
      fx += (dx / d) * (rep - att);
      fy += (dy / d) * (rep - att);
    }
    fx += Math.sin(t * 0.55 + i * 7.0) * 0.02;
    fy += Math.cos(t * 0.50 + i * 9.0) * 0.02;

    comps[i].vel.x = (comps[i].vel.x + fx * dt) * damp;
    comps[i].vel.y = (comps[i].vel.y + fy * dt) * damp;
    comps[i].pos.addScaledVector(comps[i].vel, dt);

    if (comps[i].pos.x < minX) { comps[i].pos.x = minX; comps[i].vel.x *= -0.86; }
    if (comps[i].pos.x > maxX) { comps[i].pos.x = maxX; comps[i].vel.x *= -0.86; }
    if (comps[i].pos.y < minY) { comps[i].pos.y = minY; comps[i].vel.y *= -0.86; }
    if (comps[i].pos.y > maxY) { comps[i].pos.y = maxY; comps[i].vel.y *= -0.86; }
  }
  for (let i = 0; i < 5; i++) points[i].copy(comps[i].pos);
}

// -------------------- Layer 2: Glass Grid --------------------
const layer2 = document.createElement("canvas");
layer2.id = "layer2";
layer2.className = "bg-layer";
layer2.setAttribute("aria-hidden", "true");
document.body.appendChild(layer2);
const g2 = layer2.getContext("2d")!;

function drawGrid(w: number, h: number) {
  layer2.width = w;
  layer2.height = h;
  g2.clearRect(0, 0, w, h);

  const { size, gap, alpha, sparkleAlpha } = CONFIG.grid;
  if (alpha <= 0) return;

  g2.lineWidth = 1;
  g2.strokeStyle = `rgba(255,255,255,${alpha})`;

  const ox = uniforms.uMouse.value.x * 0.0008;
  const oy = uniforms.uMouse.value.y * 0.0008;

  for (let y = 0; y < h + size; y += size + gap) {
    for (let x = 0; x < w + size; x += size + gap) {
      const xx = x + ox;
      const yy = y + oy;
      g2.strokeRect(xx + 0.5, yy + 0.5, size, size);

      const n = noise2(xx * 0.02, yy * 0.02);
      if (n > 0.74) {
        g2.fillStyle = `rgba(255,255,255,${sparkleAlpha})`;
        g2.fillRect(xx + 2, yy + 2, 2, 2);
      }
    }
  }
}

// -------------------- Shared: resize + mouse --------------------
let currentDpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprMax);
let running = true;

function setMouse(x: number, y: number) {
  uniforms.uMouse.value.set(x * currentDpr, (window.innerHeight - y) * currentDpr);
  if (physicsApi) physicsApi.setMouse(uniforms.uMouse.value.x, uniforms.uMouse.value.y);
}
window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  if (t) setMouse(t.clientX, t.clientY);
}, { passive: true });

window.addEventListener("resize", () => resize());
document.addEventListener("visibilitychange", () => { running = !document.hidden; });

// -------------------- Gallery Director --------------------
type GalleryMode = { name: "ICE" | "NEON" | "VIOLET" | "MONO"; mood: number; grade: number };
const MODES: GalleryMode[] = [
  { name: "ICE", mood: 0.10, grade: 0.25 },
  { name: "NEON", mood: 0.45, grade: 0.55 },
  { name: "VIOLET", mood: 0.80, grade: 0.70 },
  { name: "MONO", mood: 0.98, grade: 0.10 }, // handled in physics palette
];

let modeIndex = 0;
let mood = MODES[0].mood;
let moodTarget = MODES[0].mood;
let grade = MODES[0].grade;
let gradeTarget = MODES[0].grade;
let modeTimer = 0;

function chooseNextMode() {
  modeIndex = (modeIndex + 1) % MODES.length;
  moodTarget = MODES[modeIndex].mood;
  gradeTarget = MODES[modeIndex].grade;
}

function applyGradeToBody() {
  // subtle overall grade via CSS filter on top layers (professional gallery feel)
  // keep it subtle (no obvious filter)
  const sat = 1.0 + grade * 0.12;
  const con = 1.0 + grade * 0.10;
  const bri = 1.0 + grade * 0.04;
  layer2.style.filter = `saturate(${sat}) contrast(${con}) brightness(${bri})`;
  layer3.style.filter = `saturate(${sat}) contrast(${con}) brightness(${bri})`;
}

// -------------------- Lazy Physics --------------------
const layer3 = document.createElement("canvas");
layer3.id = "layer3";
layer3.className = "bg-layer";
layer3.setAttribute("aria-hidden", "true");
document.body.appendChild(layer3);

type PhysicsApi = {
  resize: (w: number, h: number, dpr: number) => void;
  setMouse: (mx: number, my: number) => void;
  setMood: (mood: number) => void;
  setMode: (name: string) => void;
  setDensity: (count: number) => void;
  step: (t: number, dt: number) => void;
};

let physicsApi: PhysicsApi | null = null;

function adaptiveCount(w: number, h: number) {
  // Adaptive density for devices (iPad/mobile/desktop)
  const area = (w * h) / 1_000_000; // in MP (device pixels)
  // approx: 0.8MP => ~14, 2.5MP => ~22, 5MP => ~30
  return clamp(Math.round(12 + area * 7), 14, 32);
}

async function initPhysics() {
  if (!CONFIG.physics.enabled || CONFIG.reducedMotion) return;

  const mod = await import("./physics");
  physicsApi = mod.createPhysicsLayer(layer3, { ...CONFIG.physics }, noise2, clamp, lerp);

  // initial
  physicsApi.setMood(mood);
  physicsApi.setMode(MODES[modeIndex].name);
  applyGradeToBody();

  resize();
}
setTimeout(() => { void initPhysics(); }, CONFIG.physics.startDelayMs);

// -------------------- Resize --------------------
function resize() {
  currentDpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprMax);
  const w = Math.floor(window.innerWidth * currentDpr);
  const h = Math.floor(window.innerHeight * currentDpr);

  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);

  drawGrid(w, h);

  if (physicsApi) {
    physicsApi.resize(w, h, currentDpr);
    physicsApi.setDensity(adaptiveCount(w, h));
  }
}

// -------------------- RAF --------------------
resize();

const start = performance.now();
let last = start;

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running) {
    const t = (now - start) / 1000;
    uniforms.uTime.value = t;

    if (!CONFIG.reducedMotion) stepComponents(dt);
    renderer.render(scene, camera);

    // Gallery transitions
    modeTimer += dt;
    if (modeTimer > (14 + Math.random() * 10)) {
      modeTimer = 0;
      chooseNextMode();
    }

    // smooth transition
    mood += (moodTarget - mood) * 0.02;
    grade += (gradeTarget - grade) * 0.02;

    if (physicsApi && !CONFIG.reducedMotion) {
      physicsApi.setMood(mood);
      physicsApi.setMode(MODES[modeIndex].name);
      applyGradeToBody();
      physicsApi.step(t, dt);
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

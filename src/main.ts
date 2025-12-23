import "./styles.css";
import * as THREE from "three";
import Matter from "matter-js";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

/** ====== Pro tweakables ====== */
const GRID_ALPHA = 0.02;        // اجعلها 0.0 لو تريد “شفافة تماماً” (غير مرئية)
const GRID_SIZE = 14;
const GRID_GAP  = 10;

const PHYS_COUNT = 22;
const TRAILS = true;            // true = أثر سينمائي بسيط
const TRAIL_FADE = 0.14;        // كلما قلّ، زادت الذيل/الأثر

// -------------------- Layer 1: WebGL field (5 interacting components) --------------------
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x05070b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const layer1 = renderer.domElement;
layer1.id = "layer1";
layer1.className = "bg-layer";
layer1.setAttribute("aria-hidden", "true");
document.body.appendChild(layer1);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// shader points
const points = Array.from({ length: 5 }, () => new THREE.Vector2());
const uniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uMouse: { value: new THREE.Vector2(0, 0) },
  uMotion: { value: prefersReducedMotion ? 0.0 : 1.0 },
  uPoints: { value: points },
};

const material = new THREE.ShaderMaterial({
  vertexShader: vert,
  fragmentShader: frag,
  uniforms,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

// 5 components simulation (pro: spring/damping + pairwise forces)
type Comp = { pos: THREE.Vector2; vel: THREE.Vector2; };
const comps: Comp[] = Array.from({ length: 5 }, (_, i) => ({
  pos: new THREE.Vector2((i - 2) * 0.35, (Math.random() - 0.5) * 0.35),
  vel: new THREE.Vector2((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04),
}));

// -------------------- Layer 2: glass grid squares --------------------
const layer2 = document.createElement("canvas");
layer2.id = "layer2";
layer2.className = "bg-layer";
layer2.setAttribute("aria-hidden", "true");
document.body.appendChild(layer2);
const g2 = layer2.getContext("2d")!;

// -------------------- Layer 3: Matter.js physics + custom draw --------------------
const layer3 = document.createElement("canvas");
layer3.id = "layer3";
layer3.className = "bg-layer";
layer3.setAttribute("aria-hidden", "true");
document.body.appendChild(layer3);
const g3 = layer3.getContext("2d")!;

const { Engine, Bodies, Composite, Body, Constraint } = Matter;

const engine = Engine.create();
engine.gravity.scale = 0; // free-float
const world = engine.world;

let bounds: Matter.Body[] = [];
let bodies: Matter.Body[] = [];
let constraints: Matter.Constraint[] = [];

let running = true;

// simple smooth noise
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

function rebuildBounds(w: number, h: number) {
  bounds.forEach(b => Composite.remove(world, b));
  const thick = 120;
  bounds = [
    Bodies.rectangle(w / 2, -thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(w / 2, h + thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(-thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(w + thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
  ];
  Composite.add(world, bounds);
}

function rebuildBodies(w: number, h: number) {
  bodies.forEach(b => Composite.remove(world, b));
  constraints.forEach(c => Composite.remove(world, c));
  bodies = [];
  constraints = [];

  for (let i = 0; i < PHYS_COUNT; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 10 + Math.random() * 18;

    const isCircle = Math.random() < 0.55;
    const b = isCircle
      ? Bodies.circle(x, y, r, { restitution: 0.92, frictionAir: 0.012, density: 0.001 })
      : Bodies.polygon(x, y, 3 + Math.floor(Math.random() * 5), r, { restitution: 0.92, frictionAir: 0.012, density: 0.001 });

    // initial motion
    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.10);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.5) * 2.4 });

    bodies.push(b);
  }

  // add a few soft constraints (professional "interaction" feel)
  for (let i = 0; i < Math.floor(PHYS_COUNT * 0.22); i++) {
    const a = bodies[Math.floor(Math.random() * bodies.length)];
    const b = bodies[Math.floor(Math.random() * bodies.length)];
    if (a === b) continue;
    const c = Constraint.create({
      bodyA: a,
      bodyB: b,
      stiffness: 0.002 + Math.random() * 0.004,
      damping: 0.08 + Math.random() * 0.08,
      length: 60 + Math.random() * 140,
      render: { visible: false }
    });
    constraints.push(c);
  }

  Composite.add(world, bodies);
  Composite.add(world, constraints);
}

function drawGrid(w: number, h: number) {
  layer2.width = w; layer2.height = h;
  g2.clearRect(0, 0, w, h);

  // glass squares: extremely subtle
  g2.lineWidth = 1;
  g2.strokeStyle = `rgba(255,255,255,${GRID_ALPHA})`;

  // micro-noise overlay (subtle)
  const noiseAlpha = GRID_ALPHA * 0.6;

  for (let y = 0; y < h + GRID_SIZE; y += GRID_SIZE + GRID_GAP) {
    for (let x = 0; x < w + GRID_SIZE; x += GRID_SIZE + GRID_GAP) {
      g2.strokeRect(x + 0.5, y + 0.5, GRID_SIZE, GRID_SIZE);

      // tiny highlight (still not an object)
      if (GRID_ALPHA > 0) {
        const n = noise2(x * 0.02, y * 0.02);
        if (n > 0.72) {
          g2.fillStyle = `rgba(255,255,255,${noiseAlpha})`;
          g2.fillRect(x + 2, y + 2, 2, 2);
        }
      }
    }
  }
}

// -------------------- Shared: resize + mouse --------------------
let currentDpr = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  currentDpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * currentDpr);
  const h = Math.floor(window.innerHeight * currentDpr);

  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);

  drawGrid(w, h);

  layer3.width = w; layer3.height = h;

  rebuildBounds(w, h);
  rebuildBodies(w, h);
}

function setMouse(x: number, y: number) {
  uniforms.uMouse.value.set(x * currentDpr, (window.innerHeight - y) * currentDpr);
}
window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  if (t) setMouse(t.clientX, t.clientY);
}, { passive: true });

window.addEventListener("resize", resize);

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
});

// -------------------- Layer 1 pro interactions (5 comps) --------------------
function stepComponents(dt: number) {
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const minX = -aspect * 0.95, maxX = aspect * 0.95;
  const minY = -0.95, maxY = 0.95;

  const kRep = 0.55;
  const kAtt = 0.14;
  const damp = 0.992;

  for (let i = 0; i < comps.length; i++) {
    let fx = 0, fy = 0;

    for (let j = 0; j < comps.length; j++) if (i !== j) {
      const dx = comps[i].pos.x - comps[j].pos.x;
      const dy = comps[i].pos.y - comps[j].pos.y;
      const d2 = dx*dx + dy*dy + 0.0015;
      const d  = Math.sqrt(d2);

      // repulsion near
      const rep = kRep / d2;

      // gentle attraction to maintain cohesion
      const att = kAtt * (d - 0.62);

      fx += (dx / d) * (rep - att);
      fy += (dy / d) * (rep - att);
    }

    // subtle drift noise
    const t = performance.now() * 0.001;
    fx += (Math.sin(t * 0.55 + i * 7.0)) * 0.020;
    fy += (Math.cos(t * 0.50 + i * 9.0)) * 0.020;

    comps[i].vel.x = (comps[i].vel.x + fx * dt) * damp;
    comps[i].vel.y = (comps[i].vel.y + fy * dt) * damp;

    comps[i].pos.addScaledVector(comps[i].vel, dt);

    // soft bounds
    if (comps[i].pos.x < minX) { comps[i].pos.x = minX; comps[i].vel.x *= -0.86; }
    if (comps[i].pos.x > maxX) { comps[i].pos.x = maxX; comps[i].vel.x *= -0.86; }
    if (comps[i].pos.y < minY) { comps[i].pos.y = minY; comps[i].vel.y *= -0.86; }
    if (comps[i].pos.y > maxY) { comps[i].pos.y = maxY; comps[i].vel.y *= -0.86; }
  }

  for (let i = 0; i < 5; i++) points[i].copy(comps[i].pos);
}

// -------------------- Layer 3: turbulence + premium draw --------------------
function applyTurbulence(t: number) {
  // smooth, non-repeatable feel via noise + rare impulses
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];

    const px = b.position.x * 0.004;
    const py = b.position.y * 0.004;

    const nx = (noise2(px + t * 0.35, py) - 0.5);
    const ny = (noise2(px, py + t * 0.35) - 0.5);

    Body.applyForce(b, b.position, { x: nx * 0.000035, y: ny * 0.000035 });

    if (Math.random() < 0.010) {
      Body.applyForce(b, b.position, { x: (Math.random()-0.5) * 0.00045, y: (Math.random()-0.5) * 0.00045 });
      Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.22);
    }
  }
}

function drawPhysics(w: number, h: number) {
  if (!TRAILS) g3.clearRect(0, 0, w, h);
  else {
    g3.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
    g3.fillRect(0, 0, w, h);
  }

  // soft glow layer
  for (const b of bodies) {
    const x = b.position.x, y = b.position.y;
    const angle = b.angle;

    // approximate radius
    const r = Math.max(10, Math.min(28, (b.bounds.max.x - b.bounds.min.x) * 0.35));

    // glow
    const grad = g3.createRadialGradient(x, y, 0, x, y, r * 2.4);
    grad.addColorStop(0, "rgba(255,255,255,0.06)");
    grad.addColorStop(1, "rgba(255,255,255,0.00)");
    g3.fillStyle = grad;
    g3.beginPath();
    g3.arc(x, y, r * 2.4, 0, Math.PI * 2);
    g3.fill();

    // body (glass)
    g3.save();
    g3.translate(x, y);
    g3.rotate(angle);

    g3.fillStyle = "rgba(255,255,255,0.045)";
    g3.strokeStyle = "rgba(255,255,255,0.10)";
    g3.lineWidth = 1;

    const verts = b.vertices;
    g3.beginPath();
    g3.moveTo(verts[0].x - x, verts[0].y - y);
    for (let i = 1; i < verts.length; i++) g3.lineTo(verts[i].x - x, verts[i].y - y);
    g3.closePath();
    g3.fill();
    g3.stroke();

    // specular highlight line
    g3.strokeStyle = "rgba(255,255,255,0.08)";
    g3.beginPath();
    g3.moveTo(-r * 0.6, -r * 0.6);
    g3.lineTo(r * 0.2, -r * 0.9);
    g3.stroke();

    g3.restore();
  }
}

// -------------------- Master loop (sync all) --------------------
resize();

const start = performance.now();
let last = start;

function loop(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (running) {
    const t = (now - start) / 1000;
    uniforms.uTime.value = t;

    if (!prefersReducedMotion) stepComponents(dt);

    // physics update (fixed-ish)
    if (!prefersReducedMotion) {
      applyTurbulence(t);
      Engine.update(engine, dt * 1000);
    }

    renderer.render(scene, camera);

    const w = Math.floor(window.innerWidth * currentDpr);
    const h = Math.floor(window.innerHeight * currentDpr);
    drawPhysics(w, h);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

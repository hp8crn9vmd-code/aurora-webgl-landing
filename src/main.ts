import "./styles.css";
import * as THREE from "three";
import Matter from "matter-js";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

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

// 5 components simulation (interacting)
type P = { pos: THREE.Vector2; vel: THREE.Vector2; };
const comps: P[] = Array.from({ length: 5 }, (_, i) => ({
  pos: new THREE.Vector2((i - 2) * 0.35, (Math.random() - 0.5) * 0.4),
  vel: new THREE.Vector2((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08),
}));

// -------------------- Layer 2: transparent squares grid --------------------
const layer2 = document.createElement("canvas");
layer2.id = "layer2";
layer2.className = "bg-layer";
layer2.setAttribute("aria-hidden", "true");
document.body.appendChild(layer2);
const g2 = layer2.getContext("2d")!;

// -------------------- Layer 3: physics 2D objects (unpredictable) --------------------
const layer3 = document.createElement("canvas");
layer3.id = "layer3";
layer3.className = "bg-layer";
layer3.setAttribute("aria-hidden", "true");
document.body.appendChild(layer3);

const {
  Engine, Render, Runner, Bodies, Composite, Body, Events,
} = Matter;

const engine = Engine.create();
engine.gravity.scale = 0; // free float (unpredictable)
const world = engine.world;

const render = Render.create({
  canvas: layer3,
  engine,
  options: {
    width: 300,
    height: 150,
    wireframes: false,
    background: "transparent",
    pixelRatio: 1,
  },
});

const runner = Runner.create();
let running = true;

// create boundaries
let bounds: Matter.Body[] = [];
function rebuildBounds(w: number, h: number) {
  bounds.forEach(b => Composite.remove(world, b));
  const thick = 80;
  bounds = [
    Bodies.rectangle(w / 2, -thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(w / 2, h + thick / 2, w + thick * 2, thick, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(-thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
    Bodies.rectangle(w + thick / 2, h / 2, thick, h + thick * 2, { isStatic: true, render: { visible: false } }),
  ];
  Composite.add(world, bounds);
}

// create random bodies
let bodies: Matter.Body[] = [];
function rebuildBodies(w: number, h: number) {
  bodies.forEach(b => Composite.remove(world, b));
  bodies = [];

  const count = 18;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 10 + Math.random() * 18;

    const isCircle = Math.random() < 0.55;
    const b = isCircle
      ? Bodies.circle(x, y, r, { restitution: 0.9, frictionAir: 0.01 })
      : Bodies.polygon(x, y, 3 + Math.floor(Math.random() * 5), r, { restitution: 0.9, frictionAir: 0.01 });

    // “شفافة”/خفيفة جداً (ليست عناصر UI واضحة)
    b.render.fillStyle = "rgba(255,255,255,0.06)";
    b.render.strokeStyle = "rgba(255,255,255,0.10)";
    b.render.lineWidth = 1;

    Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.12);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 2.2, y: (Math.random() - 0.5) * 2.2 });

    bodies.push(b);
  }
  Composite.add(world, bodies);
}

// unpredictable forces
function turbulence(t: number) {
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];

    // smooth-ish chaos + random impulses
    const nx = Math.sin(t * 0.9 + i * 13.1) + (Math.random() - 0.5) * 0.6;
    const ny = Math.cos(t * 0.8 + i * 9.7) + (Math.random() - 0.5) * 0.6;

    Body.applyForce(b, b.position, { x: nx * 0.00002, y: ny * 0.00002 });

    if (Math.random() < 0.02) {
      Body.applyForce(b, b.position, { x: (Math.random()-0.5) * 0.00035, y: (Math.random()-0.5) * 0.00035 });
      Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.25);
    }
  }
}
Events.on(engine, "beforeUpdate", () => {
  if (prefersReducedMotion) return;
  turbulence(performance.now() * 0.001);
});

// -------------------- Shared: resize + mouse --------------------
let currentDpr = Math.min(window.devicePixelRatio || 1, 2);

function drawGridSquares(w: number, h: number) {
  layer2.width = w;
  layer2.height = h;

  g2.clearRect(0, 0, w, h);

  // مربعات صغيرة "شفافة جدًا" (يمكن جعلها 0.0 إن أردت فعلاً غير مرئية)
  // هنا نستخدم stroke خفيف جدًا يعطي إحساس texture فقط.
  const size = 14;
  const gap = 10;
  const alpha = 0.05; // "تقريباً شفافة"
  g2.strokeStyle = `rgba(255,255,255,${alpha})`;
  g2.lineWidth = 1;

  for (let y = 0; y < h + size; y += size + gap) {
    for (let x = 0; x < w + size; x += size + gap) {
      g2.strokeRect(x + 0.5, y + 0.5, size, size);
    }
  }
}

function resize() {
  currentDpr = Math.min(window.devicePixelRatio || 1, 2);

  // Layer1
  const w = Math.floor(window.innerWidth * currentDpr);
  const h = Math.floor(window.innerHeight * currentDpr);
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);

  // Layer2 grid (use device pixels for crispness)
  layer2.style.width = "100vw";
  layer2.style.height = "100vh";
  drawGridSquares(w, h);

  // Layer3 (Matter Render)
  layer3.width = w;
  layer3.height = h;
  render.options.width = w;
  render.options.height = h;
  render.options.pixelRatio = 1;

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

// pause on hidden tab
document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
});

// -------------------- Animate Layer1 components + render all --------------------
resize();

Render.run(render);
Runner.run(runner, engine);

const start = performance.now();
let last = start;

function stepComponents(dt: number) {
  // bounds in "p-space"
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const minX = -aspect * 0.95, maxX = aspect * 0.95;
  const minY = -0.95, maxY = 0.95;

  // pairwise interaction: repulsion near, attraction mid, damping
  const kRep = 0.65;
  const kAtt = 0.18;
  const damp = 0.985;

  for (let i = 0; i < comps.length; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < comps.length; j++) if (i !== j) {
      const dx = comps[i].pos.x - comps[j].pos.x;
      const dy = comps[i].pos.y - comps[j].pos.y;
      const d2 = dx*dx + dy*dy + 0.001;
      const d  = Math.sqrt(d2);

      // repulse when close
      const rep = kRep / d2;

      // slight attraction at medium distance
      const att = kAtt * (d - 0.55);

      fx += (dx / d) * (rep - att);
      fy += (dy / d) * (rep - att);
    }

    // tiny noise for "alive" motion
    const t = performance.now() * 0.001;
    fx += (Math.sin(t * 0.8 + i * 10.0)) * 0.03;
    fy += (Math.cos(t * 0.7 + i * 12.0)) * 0.03;

    comps[i].vel.x = (comps[i].vel.x + fx * dt) * damp;
    comps[i].vel.y = (comps[i].vel.y + fy * dt) * damp;

    comps[i].pos.addScaledVector(comps[i].vel, dt);

    // bounce
    if (comps[i].pos.x < minX) { comps[i].pos.x = minX; comps[i].vel.x *= -0.85; }
    if (comps[i].pos.x > maxX) { comps[i].pos.x = maxX; comps[i].vel.x *= -0.85; }
    if (comps[i].pos.y < minY) { comps[i].pos.y = minY; comps[i].vel.y *= -0.85; }
    if (comps[i].pos.y > maxY) { comps[i].pos.y = maxY; comps[i].vel.y *= -0.85; }
  }

  // push to shader uniforms
  for (let i = 0; i < 5; i++) {
    points[i].copy(comps[i].pos);
  }
}

function loop(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (running) {
    uniforms.uTime.value = (now - start) / 1000;

    if (!prefersReducedMotion) {
      stepComponents(dt);
    }

    renderer.render(scene, camera);

    // Matter render runs independently; still we can pause engine updates by Runner if needed
    // (we keep it simple and rely on visibility pause above)
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

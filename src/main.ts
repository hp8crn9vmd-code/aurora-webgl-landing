import "./styles.css";
import * as THREE from "three";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x05070b, 1);

// modern color management (safe even with our shader output)
renderer.outputColorSpace = THREE.SRGBColorSpace;

const canvas = renderer.domElement;
canvas.setAttribute("aria-hidden", "true");
canvas.style.position = "fixed";
canvas.style.inset = "0";
canvas.style.width = "100vw";
canvas.style.height = "100vh";
document.body.appendChild(canvas);

// Fullscreen quad
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uMouse: { value: new THREE.Vector2(0, 0) },
  uMotion: { value: prefersReducedMotion ? 0.0 : 1.0 },
};

const material = new THREE.ShaderMaterial({
  vertexShader: vert,
  fragmentShader: frag,
  uniforms,
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

// Auto DPR control (same idea, but smoother)
let targetDpr = Math.min(window.devicePixelRatio || 1, 2);
let currentDpr = targetDpr;

function resize() {
  const w = Math.floor(window.innerWidth * currentDpr);
  const h = Math.floor(window.innerHeight * currentDpr);
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener("resize", resize);

// Smooth mouse (lerp) — feels premium
const mouseTarget = new THREE.Vector2(0, 0);
const mouseSmooth = new THREE.Vector2(0, 0);

function setMouse(x: number, y: number) {
  mouseTarget.set(x * currentDpr, (window.innerHeight - y) * currentDpr);
}

window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
window.addEventListener(
  "touchmove",
  (e) => {
    const t = e.touches[0];
    if (t) setMouse(t.clientX, t.clientY);
  },
  { passive: true }
);

resize();

// Pause on hidden tab (pro)
let running = true;
document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
});

const start = performance.now();
let last = start;

// Simple FPS-based DPR tuning
let fpsAvg = 60;
let frameCount = 0;

function loop(now: number) {
  if (!running) {
    requestAnimationFrame(loop);
    return;
  }

  const dt = (now - last) / 1000;
  last = now;

  const fps = dt > 0 ? 1 / dt : 60;
  fpsAvg = fpsAvg * 0.95 + fps * 0.05;
  frameCount++;

  // adjust roughly every ~2s on 60fps
  if (frameCount % 120 === 0) {
    const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (fpsAvg < 45 && targetDpr > 1) targetDpr = Math.max(1, targetDpr - 0.25);
    if (fpsAvg > 58 && targetDpr < maxDpr) targetDpr = Math.min(maxDpr, targetDpr + 0.25);

    if (Math.abs(targetDpr - currentDpr) > 0.01) {
      currentDpr = targetDpr;
      resize();
    }
  }

  // smooth mouse
  mouseSmooth.lerp(mouseTarget, 0.08);
  uniforms.uMouse.value.copy(mouseSmooth);

  uniforms.uTime.value = (now - start) / 1000;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

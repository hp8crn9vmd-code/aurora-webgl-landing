import "./styles.css";
import * as THREE from "three";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x05070b, 1);

const canvas = renderer.domElement;
canvas.setAttribute("aria-hidden", "true");
canvas.style.position = "fixed";
canvas.style.inset = "0";
canvas.style.width = "100vw";
canvas.style.height = "100vh";
document.body.appendChild(canvas);

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

let targetDpr = Math.min(window.devicePixelRatio || 1, 2);
let currentDpr = targetDpr;

function resize(){
  const w = Math.floor(window.innerWidth * currentDpr);
  const h = Math.floor(window.innerHeight * currentDpr);
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener("resize", resize);

function setMouse(x: number, y: number){
  uniforms.uMouse.value.set(x * currentDpr, (window.innerHeight - y) * currentDpr);
}
window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  if (t) setMouse(t.clientX, t.clientY);
}, { passive: true });

resize();

let running = true;
document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
});

const start = performance.now();
let last = start;

// simple auto-performance: if fps drops, reduce DPR a bit
let fpsAvg = 60;
let sampleCount = 0;

function loop(now: number){
  if (!running) {
    requestAnimationFrame(loop);
    return;
  }

  const dt = (now - last) / 1000;
  last = now;

  const fps = dt > 0 ? (1 / dt) : 60;
  fpsAvg = fpsAvg * 0.95 + fps * 0.05;
  sampleCount++;

  // every ~2 seconds, adjust DPR if needed
  if (sampleCount % 120 === 0) {
    if (fpsAvg < 45 && targetDpr > 1) targetDpr = Math.max(1, targetDpr - 0.25);
    if (fpsAvg > 58 && targetDpr < Math.min(window.devicePixelRatio || 1, 2)) targetDpr = Math.min(Math.min(window.devicePixelRatio || 1, 2), targetDpr + 0.25);

    if (Math.abs(targetDpr - currentDpr) > 0.01) {
      currentDpr = targetDpr;
      resize();
    }
  }

  uniforms.uTime.value = (now - start) / 1000;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

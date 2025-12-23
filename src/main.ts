import "./styles.css";
import * as THREE from "three";

import vert from "./shaders/fullscreen.vert.glsl";
import frag from "./shaders/aurora.frag.glsl";

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

// Fullscreen quad
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uMouse: { value: new THREE.Vector2(0, 0) },
};

const material = new THREE.ShaderMaterial({
  vertexShader: vert,
  fragmentShader: frag,
  uniforms,
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener("resize", resize);

function setMouse(x: number, y: number){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  uniforms.uMouse.value.set(x * dpr, (window.innerHeight - y) * dpr);
}
window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  if (t) setMouse(t.clientX, t.clientY);
}, { passive: true });

resize();
const start = performance.now();
function loop(now: number){
  uniforms.uTime.value = (now - start) / 1000;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

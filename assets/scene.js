/* KEEMZ Audio Lab — generative sound field
   Procedural point-cloud sculpture, built for slow motion and pointer response.
   Original geometry; no third-party model assets. */
import {
  Scene, PerspectiveCamera, WebGLRenderer, BufferGeometry, BufferAttribute,
  Points, ShaderMaterial, Color, Clock, Vector2, AdditiveBlending
} from './vendor/three.module.min.js';

const canvas = document.getElementById('bg');
if (canvas) {
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const scene = new Scene();
const camera = new PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 8.4);
const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x070707, 0);

const uniforms = {
  uTime: { value: 0 },
  uPointer: { value: new Vector2(0, 0) },
  uHold: { value: 0 },
  uPixelRatio: { value: renderer.getPixelRatio() }
};
const count = 36000;
const positions = new Float32Array(count * 3);
const seeds = new Float32Array(count);
const colors = new Float32Array(count * 3);
const gold = new Color('#ffd900');
const bone = new Color('#d5d1c7');
const ember = new Color('#8e8a7d');

// A folded, breathing shell: points form long flowing bands with an irregular edge.
for (let i = 0; i < count; i++) {
  const u = (i / count) * Math.PI * 2;
  const v = Math.acos(2 * ((i * 0.61803398875) % 1) - 1);
  const band = Math.sin(v * 5.5 + Math.sin(u * 3) * 1.8);
  const ripple = Math.sin(u * 7 + v * 3) * 0.16 + Math.cos(u * 11 - v * 4) * 0.09;
  const radius = 1.75 + band * 0.24 + ripple;
  const x = Math.sin(v) * Math.cos(u) * radius * 1.42;
  const y = Math.cos(v) * radius * 0.92;
  const z = Math.sin(v) * Math.sin(u) * radius * 0.58;
  positions.set([x, y, z], i * 3);
  seeds[i] = Math.random();
  const color = seeds[i] > 0.92 ? gold : seeds[i] > 0.66 ? bone : ember;
  colors.set([color.r, color.g, color.b], i * 3);
}
const geometry = new BufferGeometry();
geometry.setAttribute('position', new BufferAttribute(positions, 3));
geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
const material = new ShaderMaterial({
  transparent: true, depthWrite: false, blending: AdditiveBlending,
  uniforms,
  vertexShader: `
    uniform float uTime;
    uniform vec2 uPointer;
    uniform float uHold;
    uniform float uPixelRatio;
    attribute float aSeed;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      float t = uTime;
      float wave = sin(p.x * 1.8 + t * 0.42 + p.y * 1.2) * 0.12
                 + cos(p.z * 2.1 - t * 0.31 + p.x) * 0.10;
      p += normalize(p) * wave;
      p.x += uPointer.x * (0.12 + aSeed * 0.18);
      p.y += uPointer.y * (0.10 + aSeed * 0.12);
      p.z += sin(t * 0.25 + aSeed * 6.283) * 0.08 + uHold * sin(aSeed * 24.0 + t) * 0.14;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp((1.0 + aSeed * 1.7) * uPixelRatio * (8.0 / -mv.z), 0.7, 4.2);
      vColor = aColor;
      vAlpha = 0.28 + aSeed * 0.62;
    }`,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = length(p);
      float glow = smoothstep(0.5, 0.04, d);
      if (glow < 0.02) discard;
      gl_FragColor = vec4(vColor, glow * vAlpha * 0.78);
    }`
});
const cloud = new Points(geometry, material);
scene.add(cloud);

// A second, sparse orbit of drifting particles gives the scene depth.
const dustCount = 1800;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 3.2 + Math.random() * 3.4;
  dustPositions.set([Math.cos(a) * r * 1.6, (Math.random() - 0.5) * 5.2, Math.sin(a) * r * 0.45], i * 3);
}
const dustGeo = new BufferGeometry();
dustGeo.setAttribute('position', new BufferAttribute(dustPositions, 3));
const dustMat = new Points(dustGeo, new ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: 'uniform float uPixelRatio; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=uPixelRatio*1.2; }',
  fragmentShader: 'void main(){ gl_FragColor=vec4(0.82,0.81,0.75,0.32); }',
  uniforms: { uPixelRatio: uniforms.uPixelRatio }
}));
scene.add(dustMat);

const pointer = new Vector2();
const smooth = new Vector2();
let hold = 0;
let frame = 0;
let running = false;
const clock = new Clock();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.72 ? 52 : 42;
  camera.updateProjectionMatrix();
  uniforms.uPixelRatio.value = renderer.getPixelRatio();
  dustMat.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  if (reduced.matches) render();
}
function render() {
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;
  smooth.lerp(pointer, 0.035);
  uniforms.uPointer.value.copy(smooth);
  uniforms.uHold.value += (hold - uniforms.uHold.value) * 0.045;
  cloud.rotation.y = t * 0.035 + smooth.x * 0.13;
  cloud.rotation.x = Math.sin(t * 0.12) * 0.06 + smooth.y * 0.08;
  dustMat.rotation.y = -t * 0.012;
  renderer.render(scene, camera);
}
function tick() {
  if (!running) return;
  frame = requestAnimationFrame(tick);
  clock.getDelta();
  render();
}
function start() { if (running || reduced.matches) return; running = true; tick(); }
function stop() { running = false; cancelAnimationFrame(frame); }
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('pointermove', e => {
  pointer.set((e.clientX / innerWidth - 0.5) * 2, -(e.clientY / innerHeight - 0.5) * 2);
}, { passive: true });
window.addEventListener('pointerdown', () => { hold = 1; }, { passive: true });
window.addEventListener('pointerup', () => { hold = 0; }, { passive: true });
window.addEventListener('pointercancel', () => { hold = 0; }, { passive: true });
document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
resize();
if (reduced.matches) render(); else start();


}

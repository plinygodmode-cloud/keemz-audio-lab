/*
  KEEMZ AUDIO LAB — Three.js scene
  ---------------------------------
  A single icosahedral instrument with a wire shell and floating particles.
  Performance and accessibility are part of the design:
    · the renderer pauses when the canvas leaves the viewport, when the tab is
      hidden, and after resize storms
    · device pixel ratio is capped, particle count scales with the viewport
    · prefers-reduced-motion renders one still frame instead of an animation
    · if WebGL is unavailable the canvas is removed and the CSS ambience
      (gradient orbs, grain, orbits) carries the page
  three.js is vendored locally in /assets/vendor (MIT, r160).
*/
import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('bg');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function mount() {
  if (!canvas) return;
  if (prefersReduced.matches) {
    canvas.style.display = 'none';
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (error) {
    console.warn('[KAL] WebGL unavailable; using the static background.', error);
    canvas.remove();
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 6.4);

  const maxDpr = 1.6;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const coreGeometry = new THREE.IcosahedronGeometry(1.42, 2);
  const core = new THREE.Mesh(
    coreGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x071320,
      metalness: 0.72,
      roughness: 0.24,
      transparent: true,
      opacity: 0.94,
      clearcoat: 0.9,
      clearcoatRoughness: 0.22
    })
  );

  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.46, 2),
    new THREE.MeshBasicMaterial({ color: 0x00cfff, wireframe: true, transparent: true, opacity: 0.22 })
  );

  const innerWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.96, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff8a, wireframe: true, transparent: true, opacity: 0.1 })
  );

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.0, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff8a, wireframe: true, transparent: true, opacity: 0.07 })
  );

  scene.add(core, wire, innerWire, shell);
  scene.add(new THREE.AmbientLight(0x6a91b1, 0.65));

  const cyanLight = new THREE.PointLight(0x00cfff, 7, 14);
  cyanLight.position.set(3, 2, 3);
  const greenLight = new THREE.PointLight(0x00ff8a, 4.2, 12);
  greenLight.position.set(-3, -2, 2);
  scene.add(cyanLight, greenLight);

  const viewport = window.innerWidth;
  const particleCount = viewport < 640 ? 260 : viewport < 1024 ? 620 : 1100;
  const positions = new Float32Array(particleCount * 3);
  const speeds = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
    speeds[i] = 0.15 + Math.random() * 0.5;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({ color: 0x53dfff, size: 0.017, transparent: true, opacity: 0.4, depthWrite: false })
  );
  scene.add(particles);

  // Pointer parallax (only on precise pointers to avoid scroll jank on touch).
  let targetX = 0;
  let targetY = 0;
  let pointerX = 0;
  let pointerY = 0;
  const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (precisePointer) {
    window.addEventListener(
      'pointermove',
      event => {
        targetX = (event.clientX / window.innerWidth - 0.5) * 0.7;
        targetY = (event.clientY / window.innerHeight - 0.5) * 0.55;
      },
      { passive: true }
    );
  }

  let visible = true;
  let running = true;
  let frame = 0;
  let lastTime = performance.now();

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    if (!running) render();
  };

  let resizeTimer = 0;
  window.addEventListener(
    'resize',
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 140);
    },
    { passive: true }
  );

  function render() {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    frame += delta;
    pointerX += (targetX - pointerX) * 0.03;
    pointerY += (targetY - pointerY) * 0.03;

    core.rotation.x = frame * 0.16 + pointerY * 0.7;
    core.rotation.y = frame * 0.22 + pointerX * 0.9;
    wire.rotation.copy(core.rotation);
    innerWire.rotation.x = -frame * 0.4;
    innerWire.rotation.y = -frame * 0.32;
    shell.rotation.x = -frame * 0.07;
    shell.rotation.y = frame * 0.1;

    particles.rotation.y = frame * 0.018;
    particles.position.y = Math.sin(frame * 0.14) * 0.3;

    cyanLight.position.x = Math.sin(frame * 0.5) * 3.1;
    cyanLight.position.y = Math.cos(frame * 0.4) * 2.1;
    greenLight.position.x = Math.cos(frame * 0.35) * -2.8;

    renderer.render(scene, camera);
  }

  function loop() {
    if (!running) return;
    render();
    requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  // Pause when the canvas is off-screen (below the hero) or the tab is hidden.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      entries => {
        visible = entries[0].isIntersecting;
        if (visible && !document.hidden) start();
        else stop();
      },
      { threshold: 0.01 }
    ).observe(canvas);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  prefersReduced.addEventListener?.('change', event => {
    if (event.matches) {
      stop();
      canvas.style.display = 'none';
    } else {
      canvas.style.display = '';
      start();
    }
  });

  // A first still frame keeps the composition intact while the loop starts.
  renderer.render(scene, camera);
  start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

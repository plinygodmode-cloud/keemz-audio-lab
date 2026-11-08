/* Keemz Audio Lab — "Monolith"
   A single sculptural object in a black room: liquid-metal core, ember
   wireframe shell, orbital rings and two layers of dust. Everything is
   procedural — no textures, no CDN, no artist assets required.

   Design rules:
   · one object, one light idea, lots of negative space
   · motion is slow and heavy; nothing bounces
   · the hero is the only place the 3D runs at full rate
   · reduced motion renders a single, composed still frame */

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Group,
  Mesh,
  IcosahedronGeometry,
  SphereGeometry,
  PlaneGeometry,
  TorusGeometry,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointLight,
  AmbientLight,
  Color,
  Vector2,
  PMREMGenerator,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  AdditiveBlending,
  DoubleSide,
  BackSide,
  Clock
} from './vendor/three.module.min.js';

const canvas = document.getElementById('bg');

// Never let a missing matchMedia stop the scene (or the rest of the page).
const mediaQuery = query => {
  if (typeof window.matchMedia === 'function') return window.matchMedia(query);
  return { matches: false, addEventListener() {}, removeEventListener() {} };
};

const reduceMotion = mediaQuery('(prefers-reduced-motion: reduce)');
const finePointer = mediaQuery('(pointer: fine)');

const PALETTE = {
  ink: new Color('#050506'),
  bone: new Color('#efece4'),
  ember: new Color('#ff4a17')
};

if (canvas) {
  try {
    boot(canvas);
  } catch (error) {
    console.warn('[keemz] 3D scene unavailable, falling back to CSS ambience.', error);
    canvas.remove();
    document.documentElement.classList.add('no-webgl');
  }
}

function boot(canvasEl) {
  const renderer = new WebGLRenderer({
    canvas: canvasEl,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.1, 5.25);

  const clock = new Clock();
  const world = new Group();
  scene.add(world);

  /* ---------------------------------------------------------------- light
     Reflections do the heavy lifting, so we build a tiny studio as an
     environment map instead of shipping an HDR file. */
  const pmrem = new PMREMGenerator(renderer);
  const envScene = buildEnvironmentScene();
  const envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;
  pmrem.dispose();

  scene.add(new AmbientLight(0xffffff, 0.18));
  const key = new PointLight(0xffb489, 22, 14, 2);
  key.position.set(2.6, 2.4, 2.8);
  scene.add(key);
  const rim = new PointLight(0x5c74ff, 16, 16, 2);
  rim.position.set(-3.2, -1.4, -2.4);
  scene.add(rim);

  /* ----------------------------------------------------------------- core */
  const time = { value: 0 };
  const coreUniforms = { uTime: time, uAmp: { value: 0.016 }, uScale: { value: 0.55 } };
  const core = new Mesh(new SphereGeometry(0.95, 128, 96), liquidMetal(coreUniforms));
  world.add(core);

  // A thin atmosphere: fresnel rim in ember, additive, seen from inside.
  const auraUniforms = { uTime: time, uColor: { value: PALETTE.ember } };
  const aura = new Mesh(new SphereGeometry(1.17, 64, 64), fresnelShell(auraUniforms));
  world.add(aura);

  // A single bright seam of light wrapping the orb, like a studio rim light.
  const seam = new Mesh(
    new TorusGeometry(1.015, 0.002, 3, 400),
    new MeshBasicMaterial({
      color: PALETTE.bone,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  seam.rotation.set(Math.PI / 2.55, 0.32, 0.18);
  world.add(seam);

  // Soft halo behind the orb so it sits in light rather than floating.
  const halo = new Mesh(new PlaneGeometry(9, 9), haloMaterial());
  halo.position.z = -1.6;
  world.add(halo);

  const shell = new Mesh(
    new IcosahedronGeometry(1.3, 2),
    new MeshBasicMaterial({
      color: PALETTE.ember,
      wireframe: true,
      transparent: true,
      opacity: 0.1
    })
  );
  world.add(shell);

  const rings = new Group();
  const ringMaterial = new MeshBasicMaterial({
    color: PALETTE.bone,
    transparent: true,
    opacity: 0.14
  });
  const ringEmber = new MeshBasicMaterial({
    color: PALETTE.ember,
    transparent: true,
    opacity: 0.3
  });

  const ringA = new Mesh(new TorusGeometry(1.92, 0.0035, 3, 220), ringMaterial);
  ringA.rotation.set(Math.PI / 2.35, 0, 0);
  const ringB = new Mesh(new TorusGeometry(2.28, 0.0028, 3, 220), ringMaterial);
  ringB.rotation.set(Math.PI / 1.75, 0.4, 0);
  const ringC = new Mesh(new TorusGeometry(1.66, 0.0045, 3, 200), ringEmber);
  ringC.rotation.set(Math.PI / 2.9, -0.3, 0.5);
  rings.add(ringA, ringB, ringC);
  world.add(rings);

  /* ----------------------------------------------------------------- dust */
  const dust = new Points(dustGeometry(2600, 2.2, 7.5), dustMaterial(time, renderer.getPixelRatio()));
  world.add(dust);

  const embers = new Points(emberGeometry(140), emberMaterial(time, renderer.getPixelRatio()));
  world.add(embers);

  /* --------------------------------------------------------------- camera */
  const pointer = new Vector2(0, 0);
  const smooth = new Vector2(0, 0);
  let scroll = 0;
  let scrollTarget = 0;
  let baseY = 0.1;
  let visible = true;
  let frame = 0;
  let running = false;
  let elapsed = 0;

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    // The hero type frames the orb on all four corners, so the sculpture
    // stays dead centre at every size.
    world.position.x = 0;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // On tall phones the object should not fill the screen edge to edge.
    camera.fov = width / height < 0.75 ? 54 : 42;
    camera.updateProjectionMatrix();
    alignToHeroScript();
    dust.material.uniforms.uPixelRatio.value = dpr;
    embers.material.uniforms.uPixelRatio.value = dpr;
    if (!running) renderOnce();
  }

  /* The orb is composed to sit exactly behind the italic "audio" line, so we
     measure that line instead of guessing its vertical centre. */
  function alignToHeroScript() {
    const script = document.querySelector('.hero-script');
    if (!script) return;
    const rect = script.getBoundingClientRect();
    if (!rect.height) return;
    const centre = rect.top + rect.height / 2;
    const offsetPx = window.innerHeight / 2 - centre;
    const worldHeight = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * camera.position.z;
    const perPixel = worldHeight / window.innerHeight;
    baseY = offsetPx * perPixel * 0.92;
    world.position.y = baseY;
  }

  function renderOnce() {
    placeCamera(0);
    world.rotation.y = -0.5 + smooth.x * 0.28;
    world.rotation.x = smooth.y * -0.15;
    renderer.render(scene, camera);
  }

  function placeCamera(p) {
    camera.position.x = smooth.x * 0.42;
    camera.position.y = 0.14 + smooth.y * -0.26 + p * 0.45;
    camera.position.z = 5.25 - p * 0.55;
    camera.lookAt(0, p * 0.35, 0);
  }

  function tick() {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const delta = Math.min(clock.getDelta(), 0.05);
    elapsed += delta;
    time.value = elapsed;

    scroll += (scrollTarget - scroll) * Math.min(1, delta * 4.5);
    smooth.x += (pointer.x - smooth.x) * Math.min(1, delta * 3.2);
    smooth.y += (pointer.y - smooth.y) * Math.min(1, delta * 3.2);

    core.rotation.y = elapsed * 0.08;
    core.rotation.x = Math.sin(elapsed * 0.18) * 0.06;
    seam.rotation.z = 0.18 + Math.sin(elapsed * 0.2) * 0.1;

    shell.rotation.y = -elapsed * 0.1 - scroll * 0.5;
    shell.rotation.z = Math.sin(elapsed * 0.18) * 0.1;

    rings.rotation.y = elapsed * 0.055 + smooth.x * 0.22;
    rings.rotation.x = scroll * 0.35;
    ringC.rotation.z = 0.5 + elapsed * 0.08;

    world.position.y = baseY + Math.sin(elapsed * 0.42) * 0.03 - scroll * 0.24;
    world.rotation.y = -0.5 + smooth.x * 0.3 + scroll * 0.24;
    world.rotation.x = smooth.y * -0.14;

    dust.rotation.y = elapsed * 0.02;
    dust.rotation.x = Math.sin(elapsed * 0.1) * 0.05;

    placeCamera(scroll);
    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    clock.getDelta();
    tick();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- events */
  function readScroll() {
    const limit = window.innerHeight * 1.1;
    const raw = window.scrollY;
    scrollTarget = Math.min(1, Math.max(0, raw / limit));
    // Past the hero the sculpture is not on screen: stop the loop and keep the
    // last composed frame. Coming back up resumes instantly.
    const inHero = raw < window.innerHeight * 1.4;
    if (!inHero) stop();
    else if (!document.hidden && !reduceMotion.matches) start();
  }

  window.addEventListener(
    'scroll',
    readScroll,
    { passive: true }
  );
  readScroll();

  window.addEventListener('resize', resize, { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      alignToHeroScript();
      if (!running) renderOnce();
    }).catch(() => {});
  }

  if (finePointer.matches && !reduceMotion.matches) {
    window.addEventListener(
      'pointermove',
      event => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true }
    );
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  const observer = new IntersectionObserver(
    entries => {
      const entry = entries[0];
      visible = entry.isIntersecting;
      if (visible && !document.hidden && !reduceMotion.matches) start();
      else stop();
    },
    { threshold: 0 }
  );
  observer.observe(canvasEl);

  canvasEl.addEventListener(
    'webglcontextlost',
    event => {
      event.preventDefault();
      stop();
      canvasEl.remove();
      document.documentElement.classList.add('no-webgl');
    },
    false
  );

  resize();

  if (reduceMotion.matches) {
    // One composed frame: still sculptural, zero motion.
    elapsed = 2.6;
    time.value = elapsed;
    core.rotation.set(0.16, -0.42, 0);
    shell.rotation.y = 0.3;
    running = false;
    renderOnce();
    reduceMotion.addEventListener('change', event => {
      if (event.matches) {
        stop();
        renderOnce();
      } else {
        start();
      }
    });
  } else {
    start();
  }
}

/* ------------------------------------------------------------------ shader */

function liquidMetal(uniforms) {
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.045,
    envMapIntensity: 1.75,
    clearcoat: 1,
    clearcoatRoughness: 0.04
  });

  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.uniforms.uScale = uniforms.uScale;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uAmp;
        uniform float uScale;
        // Slow, heavy, non-repeating surface breathing (three octaves).
        float kalWave(vec3 p, float t) {
          vec3 q = p * uScale;
          return sin(q.x * 1.55 + t * 0.62) * 0.55
               + sin(q.y * 1.95 - t * 0.48) * 0.38
               + sin(q.z * 1.72 + t * 0.41) * 0.34
               + sin((q.x + q.y + q.z) * 1.15 + t * 0.33) * 0.26;
        }
        vec3 kalDisplace(vec3 p, float t) {
          float d = kalWave(p, t) * uAmp;
          return p + normalize(p) * d;
        }
        vec3 kalNormal(vec3 p, vec3 n, float t) {
          // Numeric gradient on the tangent plane, cheap and stable for a
          // sphere-like mesh.
          vec3 helper = abs(n.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 t1 = normalize(cross(n, helper));
          vec3 t2 = normalize(cross(n, t1));
          float e = 0.035;
          float base = kalWave(p, t);
          float s1 = (kalWave(p + t1 * e, t) - base) / e;
          float s2 = (kalWave(p + t2 * e, t) - base) / e;
          return normalize(n - t1 * s1 * uAmp - t2 * s2 * uAmp);
        }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = kalNormal(position, normal, uTime);`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = kalDisplace(position, uTime);`
      );
  };

  material.customProgramCacheKey = () => 'kal-liquid-metal-1';
  return material;
}

function fresnelShell(uniforms) {
  return new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uniforms,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // The back faces give us the inner rim of the shell.
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
        float pulse = 0.8 + 0.2 * sin(uTime * 0.5);
        gl_FragColor = vec4(uColor, fresnel * 0.5 * pulse);
      }
    `
  });
}

function haloMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uWarm: { value: new Color('#ff6a2b') },
      uCool: { value: new Color('#5a63ff') }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uWarm;
      uniform vec3 uCool;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p);
        // A soft pool of light, warmer to the upper right.
        float glow = pow(smoothstep(0.52, 0.0, d), 2.6);
        vec3 color = mix(uCool, uWarm, smoothstep(-0.35, 0.45, p.x + p.y * 0.6));
        gl_FragColor = vec4(color, glow * 0.26);
      }
    `
  });
}

function buildEnvironmentScene() {
  const envScene = new Scene();
  const geometry = new IcosahedronGeometry(14, 2);
  const material = new ShaderMaterial({
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uWarm: { value: new Color('#ffb083') },
      uCool: { value: new Color('#5566ff') },
      uInk: { value: new Color('#07070a') }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      uniform vec3 uInk;
      void main() {
        vec3 d = normalize(vDir);
        float up = smoothstep(-0.35, 1.0, d.y);
        float low = smoothstep(0.25, -1.0, d.y);
        vec3 color = uInk;
        color += uWarm * pow(up, 1.6) * 0.85;
        color += uCool * pow(low, 2.0) * 0.55;
        // Two soft boxes: a warm one high left, a cool strip right.
        float softbox = smoothstep(0.72, 0.98, dot(d, normalize(vec3(-0.55, 0.72, 0.42))));
        float strip = smoothstep(0.9, 0.995, dot(d, normalize(vec3(0.86, 0.12, 0.5))));
        color += vec3(1.0, 0.93, 0.86) * softbox * 2.6;
        color += vec3(0.62, 0.72, 1.0) * strip * 1.9;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  envScene.add(new Mesh(geometry, material));
  return envScene;
}

function dustGeometry(count, inner, outer) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const radius = inner + Math.pow(Math.random(), 0.65) * (outer - inner);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    seeds[i] = Math.random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  return geometry;
}

function dustMaterial(time, pixelRatio) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: time,
      uPixelRatio: { value: pixelRatio },
      uWarm: { value: PALETTE.ember },
      uCool: { value: PALETTE.bone }
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vWarm;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.12 + aSeed * 6.283) * 0.22;
        p.x += cos(uTime * 0.09 + aSeed * 9.1) * 0.16;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float twinkle = 0.35 + 0.65 * pow(abs(sin(uTime * 0.35 + aSeed * 6.283)), 2.0);
        gl_PointSize = (1.1 + aSeed * 2.1) * uPixelRatio * (7.0 / -mv.z) * 1.6;
        gl_Position = projectionMatrix * mv;
        vAlpha = twinkle * smoothstep(9.0, 3.0, -mv.z);
        vWarm = step(0.86, aSeed);
      }
    `,
    fragmentShader: `
      uniform vec3 uWarm;
      uniform vec3 uCool;
      varying float vAlpha;
      varying float vWarm;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float mask = smoothstep(0.5, 0.05, d);
        if (mask <= 0.001) discard;
        vec3 color = mix(uCool, uWarm, vWarm);
        gl_FragColor = vec4(color, mask * vAlpha * 0.8);
      }
    `
  });
}

function emberGeometry(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.5 + Math.random() * 2.4;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 7;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    seeds[i] = Math.random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  return geometry;
}

function emberMaterial(time, pixelRatio) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: time,
      uPixelRatio: { value: pixelRatio },
      uColor: { value: PALETTE.ember }
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.16 + aSeed * 0.22) + 3.5, 7.0) - 3.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.6 + aSeed * 2.4) * uPixelRatio * (6.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
        float fade = 1.0 - abs(p.y) / 3.5;
        vAlpha = clamp(fade, 0.0, 1.0) * (0.25 + aSeed * 0.5);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float mask = smoothstep(0.5, 0.0, d);
        if (mask <= 0.001) discard;
        gl_FragColor = vec4(uColor, mask * vAlpha);
      }
    `
  });
}

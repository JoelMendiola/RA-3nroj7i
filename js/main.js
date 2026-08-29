import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { CONFIG, clamp, fmt } from './config.js';
import { startCamera } from './camera.js';
import { createWorld } from './physics.js';
import { Surfaces } from './surfaces.js';
import { spawnObject, sync, grabObject, holdObject, releaseObject } from './objects.js';
import { createHandLandmarker, HandTracker, HAND_CONNECTIONS } from './hands.js';
import { createVideoPanels } from './video-panels.js';
import { WebXRSession } from './webxr.js';

window.__app = {};

const app = window.__app;
Object.assign(app, {
  started: false,
  renderer: null,
  scene: null,
  camera: null,
  stereo: null,
  world: null,
  surfaces: null,
  objects: [],
  heldByHand: [null, null],
  tracker: null,
  cam: null,
  videoPanels: null,
  webxr: null,
  handVis: null,
  mode: 'ar',
  frameCount: 0,
  lastFpsTime: 0,
});

function camInfo(video) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const aspect = width / height;
  const vFov = (CONFIG.V_FOV_DEG * Math.PI) / 180;
  const focalPy = height / 2 / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const focalPx = width / 2 / Math.tan(hFov / 2);
  return { width, height, vFov, focalPx, focalPy };
}

function unproject(nx, ny, depth, cam) {
  return new THREE.Vector3(
    ((nx - 0.5) * cam.width) / cam.focalPx * depth,
    ((0.5 - ny) * cam.height) / cam.focalPy * depth,
    -depth
  );
}

function initThree() {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('stereo-canvas'),
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    CONFIG.V_FOV_DEG,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(1, 2, 1);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const stereo = new StereoEffect(renderer);
  stereo.setEyeSeparation(CONFIG.INITIAL_IPD);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    app.videoPanels?.resize();
  });

  return { renderer, scene, camera, stereo };
}

function spawnInitialObjects(profile = 'sbs') {
  for (let i = 0; i < CONFIG.OBJECT_COUNT; i++) {
    const pos = profile === 'xr'
      ? new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          0.3 + Math.random() * 0.8,
          -0.4 - Math.random() * 1.0
        )
      : new THREE.Vector3(
          (Math.random() - 0.5) * 0.7,
          0.2 + Math.random() * 0.5,
          -0.6 - Math.random() * 0.6
        );
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      Math.random() * 0.6,
      (Math.random() - 0.5) * 0.3
    );
    const obj = spawnObject(app.scene, app.world, app.world.ballMat, pos, vel);
    app.objects.push(obj);
  }
}

function disposeObject(obj) {
  app.scene.remove(obj.mesh);
  obj.mesh.geometry.dispose();
  obj.mesh.material.dispose();
  app.world.removeBody(obj.body);
}

function resetObjects(profile = 'sbs') {
  app.heldByHand = [null, null];
  for (const obj of app.objects) disposeObject(obj);
  app.objects.length = 0;
  spawnInitialObjects(profile);
  app.videoPanels.resize();
}

function projectToScreen(pos, cam) {
  const z = pos.z;
  if (z > -0.1) return null;
  const nx = 0.5 + (pos.x * cam.focalPx) / (cam.width * -z);
  const ny = 0.5 - (pos.y * cam.focalPy) / (cam.height * -z);
  return { nx, ny };
}

function nearestObject(hand, cam) {
  let best = null;
  let bestD = CONFIG.GRAB_PIXEL_FRAC;
  for (const obj of app.objects) {
    if (obj.heldBy >= 0) continue;
    const p = projectToScreen(obj.body.position, cam);
    if (!p) continue;
    const dx = (p.nx - hand.screenNx) * cam.width;
    const dy = (p.ny - hand.screenNy) * cam.height;
    const d = Math.hypot(dx, dy) / cam.width;
    if (d < bestD) {
      bestD = d;
      best = obj;
    }
  }
  return best;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function handlePinch(i, h) {
  const obj = nearestObject(h, app.cam);
  if (obj) {
    grabObject(obj, i);
    app.heldByHand[i] = obj;
    toast('Agarrado. Lanza abriendo la mano');
  }
}

function handlePinchEnd(i, h) {
  const obj = app.heldByHand[i];
  if (obj) {
    releaseObject(obj, h);
    app.heldByHand[i] = null;
    toast('Lanzado');
  }
}

function createHandVisualizers() {
  app.handVis = [];
  const colors = [0x35e07f, 0x4db8ff];
  for (let i = 0; i < 2; i++) {
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({
      color: colors[i],
      size: 0.008,
      sizeAttenuation: true,
    }));
    pts.visible = false;
    pts.frustumCulled = false;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HAND_CONNECTIONS.length * 2 * 3), 3));
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: colors[i],
      transparent: true,
      opacity: 0.75,
    }));
    lines.visible = false;
    lines.frustumCulled = false;

    app.scene.add(pts, lines);
    app.handVis.push({ pts, lines, ptsGeo, lineGeo });
  }
}

function updateHandVisualizers() {
  if (!app.handVis) return;
  for (let i = 0; i < 2; i++) {
    const h = app.tracker.hands[i];
    const v = app.handVis[i];
    v.pts.visible = h.tracked;
    v.lines.visible = h.tracked;
    if (!h.tracked) continue;

    const col = h.pinch ? 0xffd166 : (i === 0 ? 0x35e07f : 0x4db8ff);
    v.pts.material.color.setHex(col);
    v.lines.material.color.setHex(col);

    const pa = v.ptsGeo.attributes.position.array;
    for (let k = 0; k < 21; k++) {
      const p = h.points3d[k];
      pa[k * 3] = p.x;
      pa[k * 3 + 1] = p.y;
      pa[k * 3 + 2] = p.z;
    }
    v.ptsGeo.attributes.position.needsUpdate = true;

    const la = v.lineGeo.attributes.position.array;
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
      const a = h.points3d[HAND_CONNECTIONS[c][0]];
      const b = h.points3d[HAND_CONNECTIONS[c][1]];
      la[c * 6] = a.x;
      la[c * 6 + 1] = a.y;
      la[c * 6 + 2] = a.z;
      la[c * 6 + 3] = b.x;
      la[c * 6 + 4] = b.y;
      la[c * 6 + 5] = b.z;
    }
    v.lineGeo.attributes.position.needsUpdate = true;
  }
}

function wireUI() {
  const floorSlider = document.getElementById('slider-floor');
  const wallSlider = document.getElementById('slider-wall');
  const ipdSlider = document.getElementById('slider-ipd');

  floorSlider.addEventListener('input', () => {
    app.surfaces.setFloorY(parseFloat(floorSlider.value));
    document.getElementById('out-floor').textContent = fmt(app.surfaces.floorY) + ' m';
  });

  wallSlider.addEventListener('input', () => {
    app.surfaces.setWallZ(parseFloat(wallSlider.value));
    document.getElementById('out-wall').textContent = fmt(app.surfaces.wallZ) + ' m';
  });

  ipdSlider.addEventListener('input', () => {
    app.stereo.setEyeSeparation(parseFloat(ipdSlider.value));
    document.getElementById('out-ipd').textContent = fmt(parseFloat(ipdSlider.value)) + ' m';
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    resetObjects();
    toast('Objetos reiniciados');
  });

  document.getElementById('btn-guides').addEventListener('click', (e) => {
    const v = !app.surfaces.guidesVisible;
    app.surfaces.setGuidesVisible(v);
    e.target.classList.toggle('active', v);
  });

  document.getElementById('btn-camera').addEventListener('click', switchCamera);

  document.getElementById('btn-webxr').addEventListener('click', () => {
    if (app.webxr?.active) app.webxr.exit();
    else enterWebXR();
  });

  document.getElementById('btn-mode').addEventListener('click', () => {
    setMode(app.mode === 'ar' ? 'vr' : 'ar');
  });

  window.addEventListener('pointerdown', onTapSpawn);
}

function onTapSpawn(e) {
  if (!app.started) return;
  if (app.mode === 'xr') return;
  if (e.target.closest('#hud')) return;

  const w = window.innerWidth;
  const half = w / 2;
  const nx = e.clientX < half ? e.clientX / half : (e.clientX - half) / half;
  const ny = e.clientY / window.innerHeight;

  const pos = unproject(clamp(nx, 0, 1), clamp(ny, 0, 1), CONFIG.SPAWN_DEPTH, app.cam);
  const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.8, -0.3);
  const obj = spawnObject(app.scene, app.world, app.world.ballMat, pos, vel);
  app.objects.push(obj);
}

function updateStatus() {
  const el = document.getElementById('status');
  const hands = app.tracker?.hands || [];
  const tracked = hands.filter((h) => h.tracked).length;
  const pinched = hands.filter((h) => h.pinch).length;

  let text;
  if (app.mode === 'xr') {
    text = 'AR WebXR · detectando el suelo';
  } else if (app.mode === 'vr') {
    text = `Modo VR · Objetos: ${app.objects.length}`;
  } else {
    const cam = app.synthetic ? 'Simulación' : app.facing === 'user' ? 'Cámara frontal' : 'Cámara trasera';
    text = `${cam} · Manos: ${tracked} · Pinza: ${pinched}`;
  }
  el.textContent = text;

  const camBtn = document.getElementById('btn-camera');
  if (camBtn) camBtn.textContent = app.facing === 'user' ? 'Cambiar a cámara trasera' : 'Cambiar a cámara frontal';
  const modeBtn = document.getElementById('btn-mode');
  if (modeBtn) modeBtn.textContent = app.mode === 'ar' ? 'Modo VR' : 'Modo AR';
}

function checkWebXRSupport() {
  const btn = document.getElementById('btn-webxr');
  WebXRSession.isSupported().then((ok) => {
    if (!ok) {
      btn.disabled = true;
      btn.textContent = 'AR WebXR (no soportado)';
      btn.title = 'Requiere un móvil Android con ARCore (Chrome)';
    }
  });
}

function setMode(mode) {
  if (app.mode === mode || !app.started || app.mode === 'xr') return;
  app.mode = mode;

  if (mode === 'vr') {
    // Entorno oscuro: ocultamos el vídeo pero MANTENEMOS la cámara activa
    // para seguir rastreando las manos (permite agarrar y lanzar en VR).
    app.videoPanels.setVisible(false);
    app.renderer.setClearColor(CONFIG.VR_BG_COLOR, 1);

    for (let i = 0; i < 2; i++) {
      if (app.heldByHand[i]) {
        releaseObject(app.heldByHand[i], app.tracker.hands[i]);
        app.heldByHand[i] = null;
      }
    }
    document.getElementById('btn-camera').disabled = true;
    toast('Modo VR: agarra y lanza con el gesto de pinza');
  } else {
    app.renderer.setClearColor(0x000000, 0);
    app.videoPanels.setVisible(true);
    document.getElementById('btn-camera').disabled = false;
    toast('Modo AR activado');
  }

  updateStatus();
}

function stepPhysics(dt) {
  app.world.step(1 / 60, dt, 4);

  for (let i = 0; i < 2; i++) {
    const h = app.tracker.hands[i];
    const obj = app.heldByHand[i];
    if (obj && h.tracked) {
      holdObject(obj, h.tip);
    }
  }

  for (const obj of app.objects) {
    if (obj.heldBy >= 0) continue;
    sync(obj);
  }
}

function animate(time, frame) {
  const now = performance.now();
  const dt = clamp((now - (app.lastNow || now)) / 1000, 0, 0.05);
  app.lastNow = now;

  if (frame) {
    // Sesión WebXR activa
    if (app.webxr?.active) {
      app.webxr.onFrame(frame);
    }
    if (app.video?.readyState >= 2) {
      app.tracker.update(app.video, now).then(() => {}).catch(() => {});
    }
    stepPhysics(dt);
    updateHandVisualizers();
    app.renderer.render(app.scene, app.camera);
  } else {
    app.videoPanels.draw();

    if (app.video.readyState >= 2) {
      app.tracker.update(app.video, now).then(() => {
        updateStatus();
      }).catch(() => {});
    }

    stepPhysics(dt);

    updateHandVisualizers();

    app.stereo.render(app.scene, app.camera);
  }

  app.frameCount++;
  if (now - app.lastFpsTime > 500) {
    document.getElementById('fps').textContent = Math.round((app.frameCount * 1000) / (now - app.lastFpsTime)) + ' fps';
    app.frameCount = 0;
    app.lastFpsTime = now;
  }
}

function configureCamera(result) {
  app.video = result.video;
  app.facing = result.facing;
  app.synthetic = result.synthetic;
  app.mirror = result.mirror;
  app.cam = camInfo(result.video);
  app.cam.mirror = result.mirror;
  if (app.tracker) {
    app.tracker.cam = app.cam;
    app.tracker.lastVideoTime = -1;
  }
  if (app.videoPanels) app.videoPanels.setMirror(result.mirror);
}

async function switchCamera() {
  const target = app.facing === 'user' ? 'environment' : 'user';
  try {
    const result = await startCamera(target);
    configureCamera(result);
    updateStatus();
  } catch (err) {
    console.error(err);
    toast('No se pudo cambiar de cámara');
  }
}

async function enterWebXR() {
  if (app.webxr?.active || app.mode === 'xr') return;

  app.mode = 'xr';

  // Mantenemos la cámara activa (oculta) para seguir rastreando las manos con MediaPipe.
  app.videoPanels.setVisible(false);
  for (let i = 0; i < 2; i++) {
    if (app.heldByHand[i]) {
      releaseObject(app.heldByHand[i], app.tracker.hands[i]);
      app.heldByHand[i] = null;
    }
    app.tracker.hands[i].reset();
  }

  // Suelo real detectado por 'local-floor' (y = 0); ocultamos la pared, solo mostramos el suelo
  app.surfaces.setFloorY(0);
  app.surfaces.setWallZ(-2.5);
  app.surfaces.setGuidesVisible(true);
  app.surfaces.setWallGuideVisible(false);
  resetObjects('xr');

  try {
    await app.webxr.enter();
    document.getElementById('btn-webxr').textContent = 'Salir de AR WebXR';
    updateStatus();
    toast('AR WebXR: detectando el suelo…');
  } catch (err) {
    console.error(err);
    app.mode = 'ar';
    toast('No se pudo iniciar WebXR');
    await exitWebXR();
  }
}

async function exitWebXR() {
  // Volver al modo SBS con cámara + manos
  app.mode = 'ar';

  app.surfaces.setFloorY(CONFIG.INITIAL_FLOOR_Y);
  app.surfaces.setWallZ(CONFIG.INITIAL_WALL_Z);
  app.surfaces.setWallGuideVisible(true);
  resetObjects('sbs');

  try {
    const result = await startCamera(app.facing === 'environment' ? 'environment' : 'user');
    configureCamera(result);
    app.videoPanels.setVisible(true);
    document.getElementById('btn-camera').disabled = false;
  } catch (err) {
    console.error(err);
    toast('No se pudo reactivar la cámara');
  }

  document.getElementById('btn-webxr').textContent = 'AR WebXR';
  updateStatus();
}

async function start() {
  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = true;
  startBtn.textContent = 'Iniciando cámara…';

  try {
    const result = await startCamera('user');
    configureCamera(result);

    const { renderer, scene, camera, stereo } = initThree();
    app.renderer = renderer;
    app.scene = scene;
    app.camera = camera;
    app.stereo = stereo;

    const { world, ballMat, surfaceMat } = createWorld();
    app.world = world;

    app.surfaces = new Surfaces(scene, world, surfaceMat);

    const landmarker = await createHandLandmarker();
    app.tracker = new HandTracker(landmarker);
    app.tracker.cam = app.cam;
    app.tracker.onPinch = handlePinch;
    app.tracker.onPinchEnd = handlePinchEnd;

    app.videoPanels = createVideoPanels(app.video, () => app.tracker?.hands || null);
    app.videoPanels.setMirror(app.mirror);

    app.webxr = new WebXRSession(renderer);
    app.webxr.callbacks.onFrame = (det) => {
      if (det.floorY !== null) {
        app.surfaces.setFloorY(clamp(det.floorY, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX));
      }
    };
    app.webxr.callbacks.onEnd = () => exitWebXR();

    createHandVisualizers();

    spawnInitialObjects();
    wireUI();

    // Inicio directo en modo AR con la cámara visible y las interacciones ya habilitadas.
    app.mode = 'ar';
    app.videoPanels.setVisible(true);
    app.renderer.setClearColor(0x000000, 0);

    app.lastNow = performance.now();
    app.started = true;

    document.getElementById('start-screen').style.display = 'none';
    updateStatus();

    renderer.setAnimationLoop(animate);
    checkWebXRSupport();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = 'INICIAR';
    alert('No se pudo iniciar: ' + err.message);
  }
}

document.getElementById('btn-start').addEventListener('click', start);
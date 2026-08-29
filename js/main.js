import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { CONFIG, clamp, fmt } from './config.js';
import { startCamera } from './camera.js';
import { createWorld } from './physics.js';
import { Surfaces } from './surfaces.js';
import { spawnObject, sync, grabObject, holdObject, releaseObject } from './objects.js';
import { createHandLandmarker, HandTracker, HAND_CONNECTIONS } from './hands.js';
import { createVideoPanels } from './video-panels.js';
import { WebXRSession, XR_HAND_CONNECTIONS } from './webxr.js';

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
  xrHandVis: null,
  xrPrevPinch: [false, false],
  xrControllers: [],
  xrTouch: null,
  xrRaycaster: null,
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

function nearestObject3D(pos, radius) {
  let best = null;
  let bestD = radius;
  for (const obj of app.objects) {
    if (obj.heldBy >= 0) continue;
    const d = obj.body.position.distanceTo(pos);
    if (d < bestD) {
      bestD = d;
      best = obj;
    }
  }
  return best;
}

function createXRHandVisualizers() {
  app.xrHandVis = [];
  const colors = [0x35e07f, 0x4db8ff];
  for (let i = 0; i < 2; i++) {
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
    const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({
      color: colors[i],
      size: 0.012,
      sizeAttenuation: true,
    }));
    pts.visible = false;
    pts.frustumCulled = false;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(XR_HAND_CONNECTIONS.length * 2 * 3), 3));
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: colors[i],
      transparent: true,
      opacity: 0.75,
    }));
    lines.visible = false;
    lines.frustumCulled = false;

    app.scene.add(pts, lines);
    app.xrHandVis.push({ pts, lines, ptsGeo, lineGeo });
  }
}

function updateXRHandVisualizers(hands) {
  if (!app.xrHandVis || !hands) return;
  for (let i = 0; i < 2; i++) {
    const state = hands[i];
    const v = app.xrHandVis[i];
    const tracked = !!(state && state.tracked);
    v.pts.visible = tracked;
    v.lines.visible = tracked;
    if (!tracked) continue;

    const col = state.pinch ? 0xffd166 : (i === 0 ? 0x35e07f : 0x4db8ff);
    v.pts.material.color.setHex(col);
    v.lines.material.color.setHex(col);

    const pa = v.ptsGeo.attributes.position.array;
    for (let k = 0; k < 25; k++) {
      const p = state.points[k];
      pa[k * 3] = p.x;
      pa[k * 3 + 1] = p.y;
      pa[k * 3 + 2] = p.z;
    }
    v.ptsGeo.attributes.position.needsUpdate = true;

    const la = v.lineGeo.attributes.position.array;
    for (let c = 0; c < XR_HAND_CONNECTIONS.length; c++) {
      const a = state.points[XR_HAND_CONNECTIONS[c][0]];
      const b = state.points[XR_HAND_CONNECTIONS[c][1]];
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

function updateXRInteraction() {
  const hands = app.webxr?.hands || [];
  for (let i = 0; i < 2; i++) {
    const h = hands[i];
    const prevPinch = app.xrPrevPinch[i];

    if (h && h.tracked && h.pinch && !prevPinch) {
      const obj = nearestObject3D(h.tip, 0.16);
      if (obj) {
        grabObject(obj, i);
        app.heldByHand[i] = obj;
      }
    } else if ((!h || !h.tracked || !h.pinch) && prevPinch) {
      const obj = app.heldByHand[i];
      if (obj) {
        releaseObject(obj, h || { velocity: new THREE.Vector3() });
        app.heldByHand[i] = null;
      }
    }

    app.xrPrevPinch[i] = !!(h && h.tracked && h.pinch);
  }
}

function pickFromXRRay(controller) {
  app.xrRaycaster.setFromXRController(controller);
  const hits = app.xrRaycaster.intersectObjects(app.objects.map((o) => o.mesh), false);
  if (!hits.length) return null;
  const obj = app.objects.find((candidate) => candidate.mesh === hits[0].object);
  return obj ? { obj, distance: hits[0].distance } : null;
}

function holdXRControllerObject(controllerData) {
  const obj = controllerData.object;
  if (!obj) return;
  const now = performance.now();
  app.xrRaycaster.setFromXRController(controllerData.controller);
  const p = app.xrRaycaster.ray.origin.clone().add(
    app.xrRaycaster.ray.direction.clone().multiplyScalar(controllerData.distance)
  );
  const dt = Math.max((now - controllerData.lastTime) / 1000, 1 / 120);
  if (controllerData.lastTime > 0) {
    controllerData.velocity.copy(p).sub(controllerData.lastPoint).multiplyScalar(1 / dt);
    if (controllerData.velocity.length() > 14) controllerData.velocity.setLength(14);
  }
  holdObject(obj, p);
  controllerData.lastPoint.copy(p);
  controllerData.lastTime = now;
}

function startXRControllerGrab(index) {
  const data = app.xrControllers[index];
  if (!data || app.webxr?.hands?.[index]?.tracked) return;
  const hit = pickFromXRRay(data.controller);
  if (!hit) return;
  data.object = hit.obj;
  data.distance = hit.distance;
  data.lastPoint.copy(hit.obj.body.position);
  data.lastTime = performance.now();
  grabObject(hit.obj, index);
}

function endXRControllerGrab(index) {
  const data = app.xrControllers[index];
  if (!data?.object) return;
  releaseObject(data.object, { velocity: data.velocity });
  data.object = null;
}

function createXRControllerFallbacks() {
  app.xrRaycaster = new THREE.Raycaster();
  app.xrControllers = [];

  for (let i = 0; i < 2; i++) {
    const controller = app.renderer.xr.getController(i);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x35e07f, transparent: true, opacity: 0.65 })
    );
    line.scale.z = 3;
    controller.add(line);
    controller.addEventListener('selectstart', () => startXRControllerGrab(i));
    controller.addEventListener('selectend', () => endXRControllerGrab(i));
    app.scene.add(controller);
    app.xrControllers.push({
      controller,
      object: null,
      distance: 0,
      lastPoint: new THREE.Vector3(),
      lastTime: 0,
      velocity: new THREE.Vector3(),
    });
  }
}

function updateXRControllerFallbacks() {
  for (const data of app.xrControllers) {
    if (!data.object) continue;
    holdXRControllerObject(data);
  }
}

function pickFromScreen(clientX, clientY) {
  const rect = app.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  app.xrRaycaster.setFromCamera(ndc, app.camera);
  const hits = app.xrRaycaster.intersectObjects(app.objects.map((o) => o.mesh), false);
  if (!hits.length) return null;
  const obj = app.objects.find((candidate) => candidate.mesh === hits[0].object);
  return obj ? { obj, distance: hits[0].distance } : null;
}

function onXRPointerDown(event) {
  if (app.mode !== 'xr') return;
  if (event.target.closest('button, input, label, .controls, .sliders')) return;
  if (app.webxr?.hands?.some((h) => h.tracked)) return;
  const hit = pickFromScreen(event.clientX, event.clientY);
  if (!hit) return;
  app.xrTouch = {
    object: hit.obj,
    distance: hit.distance,
    lastPoint: hit.obj.body.position.clone(),
    lastTime: performance.now(),
    velocity: new THREE.Vector3(),
  };
  grabObject(hit.obj, 0);
  event.preventDefault();
}

function onXRPointerMove(event) {
  if (!app.xrTouch || app.mode !== 'xr') return;
  const rect = app.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  app.xrRaycaster.setFromCamera(ndc, app.camera);
  const p = app.xrRaycaster.ray.origin.clone().add(
    app.xrRaycaster.ray.direction.clone().multiplyScalar(app.xrTouch.distance)
  );
  const now = performance.now();
  const dt = Math.max((now - app.xrTouch.lastTime) / 1000, 1 / 120);
  app.xrTouch.velocity.copy(p).sub(app.xrTouch.lastPoint).multiplyScalar(1 / dt);
  if (app.xrTouch.velocity.length() > 14) app.xrTouch.velocity.setLength(14);
  holdObject(app.xrTouch.object, p);
  app.xrTouch.lastPoint.copy(p);
  app.xrTouch.lastTime = now;
}

function onXRPointerUp() {
  if (!app.xrTouch) return;
  releaseObject(app.xrTouch.object, { velocity: app.xrTouch.velocity });
  app.xrTouch = null;
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

  document.getElementById('btn-webxr').addEventListener('click', () => {
    if (app.webxr?.active) app.webxr.exit();
    else enterWebXR();
  });

  document.getElementById('btn-mode').addEventListener('click', () => {
    setMode(app.mode === 'ar' ? 'vr' : 'ar');
  });

  window.addEventListener('pointerdown', onTapSpawn);
  window.addEventListener('pointerdown', onXRPointerDown, { passive: false });
  window.addEventListener('pointermove', onXRPointerMove, { passive: false });
  window.addEventListener('pointerup', onXRPointerUp);
  window.addEventListener('pointercancel', onXRPointerUp);
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
    text = 'AR WebXR · suelo detectado · mano o toque para interactuar';
  } else if (app.mode === 'vr') {
    text = `Modo VR · Objetos: ${app.objects.length}`;
  } else {
    const cam = app.synthetic ? 'Simulación: sin cámara trasera' : 'Cámara trasera 1x';
    text = `${cam} · Manos: ${tracked} · Pinza: ${pinched}`;
  }
  el.textContent = text;

  const modeBtn = document.getElementById('btn-mode');
  if (modeBtn) modeBtn.textContent = app.mode === 'ar' ? 'Modo VR' : 'Modo AR';
}

function setHandTrackingLegend(visible) {
  document.getElementById('hand-tracking-legend')?.classList.toggle('hidden', !visible);
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
    toast('Modo VR: agarra y lanza con el gesto de pinza');
  } else {
    app.renderer.setClearColor(0x000000, 0);
    app.videoPanels.setVisible(true);
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
    updateXRInteraction();
    updateXRControllerFallbacks();
    if (app.xrTouch?.object) holdObject(app.xrTouch.object, app.xrTouch.lastPoint);

    app.world.step(1 / 60, dt, 4);
    for (let i = 0; i < 2; i++) {
      const obj = app.heldByHand[i];
      const h = app.webxr?.hands?.[i];
      if (obj && h && h.tracked) holdObject(obj, h.tip);
    }
    for (const obj of app.objects) if (obj.heldBy < 0) sync(obj);

    updateXRHandVisualizers(app.webxr?.hands);
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

async function enterWebXR() {
  if (app.webxr?.active || app.mode === 'xr') return;

  app.mode = 'xr';
  setHandTrackingLegend(false);

  // En XR usamos el hand-tracking nativo de WebXR (coincide con el espacio de los modelos).
  // Detenemos la captura auxiliar de MediaPipe; WebXR usa la cámara trasera de ARCore.
  if (app.video?.srcObject) {
    app.video.srcObject.getTracks().forEach((t) => t.stop());
    app.video.srcObject = null;
  }
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
  setHandTrackingLegend(false);

  app.surfaces.setFloorY(CONFIG.INITIAL_FLOOR_Y);
  app.surfaces.setWallZ(CONFIG.INITIAL_WALL_Z);
  app.surfaces.setWallGuideVisible(true);
  resetObjects('sbs');

  try {
    const result = await startCamera();
    configureCamera(result);
    app.videoPanels.setVisible(true);
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
    const result = await startCamera();
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
      setHandTrackingLegend(!det.handTrackingAvailable);
      if (det.floorY !== null) {
        app.surfaces.setFloorY(clamp(det.floorY, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX));
      }
    };
    app.webxr.callbacks.onEnd = () => exitWebXR();

    createHandVisualizers();
    createXRHandVisualizers();
    createXRControllerFallbacks();

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

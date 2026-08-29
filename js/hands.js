import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { CONFIG, clamp } from './config.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
  );

  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      console.warn(`HandLandmarker falló con delegate ${delegate}:`, err);
    }
  }
  throw new Error('No se pudo crear HandLandmarker');
}

export class HandState {
  constructor() {
    this.tracked = false;
    this.pinch = false;
    this.depth = 0;
    this.tip = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.points3d = new Array(21);
    for (let k = 0; k < 21; k++) this.points3d[k] = new THREE.Vector3();
    this._history = [];
    this._pinchStart = false;
  }

  update(lm, wlm, cam, now) {
    this.landmarks = lm;
    const iTip = lm[8];
    const tTip = lm[4];
    const wrist = lm[0];
    const middleMcp = lm[9];

    const mirror = !!cam.mirror;
    const mx = (x) => (mirror ? 1 - x : x);

    const nx = mx(iTip.x);
    const ny = iTip.y;
    const px = nx * cam.width;
    const py = ny * cam.height;
    const pixelSize = Math.hypot(
      (middleMcp.x - wrist.x) * cam.width,
      (middleMcp.y - wrist.y) * cam.height
    );

    if (pixelSize < 1) {
      this.tracked = false;
      this._pinchStart = false;
      return;
    }

    const depth = clamp(
      (CONFIG.KNOWN_HAND_SIZE * cam.focalPx) / pixelSize,
      0.15,
      3.0
    );
    this.depth = depth;

    this.tip.set(
      ((px - cam.width / 2) / cam.focalPx) * depth,
      ((cam.height / 2 - py) / cam.focalPy) * depth,
      -depth
    );

    // Proyección 3D de los 21 landmarks (para dibujar los puntos de la mano en la escena)
    for (let k = 0; k < 21; k++) {
      const l = lm[k];
      const lx = mx(l.x);
      const ly = l.y;
      this.points3d[k].set(
        ((lx * cam.width - cam.width / 2) / cam.focalPx) * depth,
        ((cam.height / 2 - ly * cam.height) / cam.focalPy) * depth,
        -depth
      );
    }

    // posición 2D normalizada (ya con espejo) para el agarre en pantalla
    this.screenNx = nx;
    this.screenNy = ny;

    const pinchPx = Math.hypot((tTip.x - iTip.x) * cam.width, (tTip.y - iTip.y) * cam.height);
    const open = pinchPx > cam.width * 0.040;
    const close = pinchPx < cam.width * 0.024;

    if (open) {
      this.pinch = false;
    } else if (close) {
      this.pinch = true;
    }

    const wasPinched = this._pinchStart;
    this._pinchStart = this.pinch;
    this.tracked = true;

    this._history.push({ p: this.tip.clone(), t: now });
    while (this._history.length && now - this._history[0].t > 130) {
      this._history.shift();
    }

    if (this._history.length > 1) {
      const a = this._history[0];
      const b = this._history[this._history.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.008) {
        this.velocity.copy(b.p).sub(a.p).multiplyScalar(1 / dt);
        if (this.velocity.length() > CONFIG.MAX_SPEED) {
          this.velocity.setLength(CONFIG.MAX_SPEED);
        }
      }
    }
  }

  reset() {
    this.tracked = false;
    this._pinchStart = false;
  }
}

export class HandTracker {
  constructor(landmarker) {
    this.landmarker = landmarker;
    this.lastVideoTime = -1;
    this._busy = false;
    this.hands = [new HandState(), new HandState()];
    this.onPinch = () => {};
    this.onPinchEnd = () => {};
  }

  async update(video, now) {
    if (this._busy) return null;
    if (this.lastVideoTime === video.currentTime) return null;
    this.lastVideoTime = video.currentTime;
    this._busy = true;

    let res;
    try {
      res = await this.landmarker.detectForVideo(video, now);
    } catch (err) {
      return null;
    } finally {
      this._busy = false;
    }

    if (!res || !res.landmarks) return null;

    const lmList = res.landmarks || [];
    const wlmList = res.worldLandmarks || [];

    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const prevPinch = h.pinch;
      const wasTracked = h.tracked;

      if (lmList[i]) {
        h.update(lmList[i], wlmList[i], this.cam, now);
      } else {
        h.reset();
      }

      if (h.tracked && !wasTracked) {
        // hand appeared, ignore stale velocity
        h.velocity.setZero();
        h._history.length = 0;
      }

      if (h.tracked && h.pinch && !prevPinch) {
        this.onPinch(i, h);
      }
      if ((!h.tracked || !h.pinch) && prevPinch) {
        this.onPinchEnd(i, h);
      }
    }

    return this.hands;
  }
}
import * as THREE from 'three';

const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

export const XR_HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
];

const THUMB_TIP = 4;
const INDEX_TIP = 9;
const PINCH_DIST = 0.035;

export class XRHandState {
  constructor() {
    this.tracked = false;
    this.pinch = false;
    this.tip = new THREE.Vector3();
    this.thumb = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.points = Array.from({ length: 25 }, () => new THREE.Vector3());
    this._history = [];
  }

  reset() {
    this.tracked = false;
    this._history.length = 0;
  }
}

export class WebXRSession {
  constructor(renderer) {
    this.renderer = renderer;
    this.session = null;
    this.referenceSpace = null;
    this.active = false;

    this.downSource = null;
    this.sourcesRequested = false;

    this.hands = [new XRHandState(), new XRHandState()];

    this.callbacks = {
      onFrame: null,
      onStart: null,
      onEnd: null,
    };
  }

  static async isSupported() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  async enter() {
    const sessionInit = {
      requiredFeatures: ['hit-test', 'local-floor'],
      optionalFeatures: ['dom-overlay', 'hand-tracking'],
    };

    const hud = document.getElementById('hud');
    if (hud) sessionInit.domOverlay = { root: hud };

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    this.session = session;
    this.active = true;
    this.sourcesRequested = false;

    session.addEventListener('end', () => this._onEnd());
    this.callbacks.onStart?.();
  }

  exit() {
    if (this.session) this.session.end();
  }

  _onEnd() {
    this.active = false;
    this.session = null;
    this.referenceSpace = null;
    this.downSource = null;
    this.sourcesRequested = false;
    this.callbacks.onEnd?.();
  }

  _requestSources() {
    if (this.sourcesRequested) return;
    this.sourcesRequested = true;

    const session = this.renderer.xr.getSession();
    if (!session) return;

    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      if (typeof XRRay !== 'undefined') {
        const downRay = new XRRay(
          { x: 0, y: 0, z: 0, w: 1 },
          { x: 0, y: -1, z: 0, w: 0 }
        );
        const down = session.requestHitTestSource({ space: viewerSpace, offsetRay: downRay });
        down.then((src) => { this.downSource = src; }).catch(() => {});
      }
    }).catch(() => {});
  }

  _readPose(hit, referenceSpace) {
    const pose = hit.getPose(referenceSpace);
    if (!pose) return null;
    const m = pose.transform.matrix;
    return { py: m[13] };
  }

  _updateHands(frame, referenceSpace) {
    for (const h of this.hands) h.reset();

    const sources = this.session.inputSources || [];
    let idx = 0;
    for (const source of sources) {
      if (!source.hand || idx > 1) continue;
      const hand = source.hand;
      const state = this.hands[idx++];
      state.tracked = true;

      for (let k = 0; k < JOINTS.length; k++) {
        const joint = hand.get(JOINTS[k]);
        const pose = joint && frame.getJointPose(joint, referenceSpace);
        if (pose) {
          const m = pose.transform.matrix;
          state.points[k].set(m[12], m[13], m[14]);
        }
      }

      state.thumb.copy(state.points[THUMB_TIP]);
      state.tip.copy(state.points[INDEX_TIP]);

      const d = state.thumb.distanceTo(state.tip);
      if (d < PINCH_DIST) state.pinch = true;
      else if (d > PINCH_DIST * 1.6) state.pinch = false;

      const now = performance.now();
      state._history.push({ p: state.tip.clone(), t: now });
      while (state._history.length && now - state._history[0].t > 130) state._history.shift();
      if (state._history.length > 1) {
        const a = state._history[0];
        const b = state._history[state._history.length - 1];
        const dt = (b.t - a.t) / 1000;
        if (dt > 0.008) {
          state.velocity.copy(b.p).sub(a.p).multiplyScalar(1 / dt);
          if (state.velocity.length() > 14) state.velocity.setLength(14);
        }
      }
    }
  }

  // Se llama cada frame. Actualiza this.hands y devuelve la altura del suelo.
  onFrame(frame) {
    this.referenceSpace = this.renderer.xr.getReferenceSpace();
    this._requestSources();

    const detections = { floorY: null, handTrackingAvailable: false };

    if (!this.referenceSpace) return detections;

    if (this.downSource) {
      let results = [];
      try { results = frame.getHitTestResults(this.downSource); } catch {}
      if (results.length) {
        const hit = this._readPose(results[0], this.referenceSpace);
        if (hit) detections.floorY = hit.py;
      }
    }

    if (detections.floorY === null) detections.floorY = 0;

    this._updateHands(frame, this.referenceSpace);
    detections.handTrackingAvailable = (this.session.inputSources || []).some((source) => !!source.hand);

    this.callbacks.onFrame?.(detections);
    return detections;
  }
}

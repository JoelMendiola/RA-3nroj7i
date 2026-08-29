import * as THREE from 'three';

export class WebXRSession {
  constructor(renderer) {
    this.renderer = renderer;
    this.session = null;
    this.referenceSpace = null;
    this.active = false;
    this.downSource = null;
    this.sourcesRequested = false;

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
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test', 'dom-overlay'],
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
      if (typeof XRRay === 'undefined') return;
      const downRay = new XRRay(
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: -1, z: 0, w: 0 }
      );
      session.requestHitTestSource({ space: viewerSpace, offsetRay: downRay })
        .then((source) => { this.downSource = source; })
        .catch(() => {});
    }).catch(() => {});
  }

  onFrame(frame) {
    this.referenceSpace = this.renderer.xr.getReferenceSpace();
    this._requestSources();

    const detections = { floorY: 0 };
    if (!this.referenceSpace) return detections;

    if (this.downSource) {
      let results = [];
      try { results = frame.getHitTestResults(this.downSource); } catch {}
      if (results.length) {
        const pose = results[0].getPose(this.referenceSpace);
        if (pose) detections.floorY = pose.transform.matrix[13];
      }
    }

    this.callbacks.onFrame?.(detections);
    return detections;
  }
}

import * as THREE from 'three';

export class WebXRSession {
  constructor(renderer) {
    this.renderer = renderer;
    this.session = null;
    this.referenceSpace = null;
    this.active = false;

    this.forwardSource = null;
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
      requiredFeatures: ['hit-test', 'local-floor'],
      optionalFeatures: ['dom-overlay'],
    };

    const hud = document.getElementById('hud');
    if (hud) {
      sessionInit.domOverlay = { root: hud };
    }

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
    this.forwardSource = null;
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
      const forward = session.requestHitTestSource({ space: viewerSpace });
      forward.then((src) => { this.forwardSource = src; }).catch(() => {});

      if (typeof XRRay !== 'undefined') {
        const downRay = new XRRay(
          { x: 0, y: 0, z: 0, w: 1 },
          { x: 0, y: -1, z: 0, w: 0 }
        );
        const down = session.requestHitTestSource({
          space: viewerSpace,
          offsetRay: downRay,
        });
        down.then((src) => { this.downSource = src; }).catch(() => {});
      }
    }).catch(() => {});
  }

  _readPose(hit, referenceSpace) {
    const pose = hit.getPose(referenceSpace);
    if (!pose) return null;
    const m = pose.transform.matrix;
    return {
      px: m[12], py: m[13], pz: m[14],
      nx: m[8], ny: m[9], nz: m[10],
    };
  }

  // Se llama cada frame de la sesión. Devuelve detecciones de planos.
  onFrame(frame) {
    this.referenceSpace = this.renderer.xr.getReferenceSpace();
    this._requestSources();

    const detections = {
      floorY: null,   // superficie horizontal (suelo)
      wallZ: null,    // superficie vertical enfrente (pared)
    };

    if (!this.referenceSpace) return detections;

    // Pared: rayo frontal (clasificamos horizontal vs vertical por la normal)
    if (this.forwardSource) {
      let results = [];
      try { results = frame.getHitTestResults(this.forwardSource); } catch {}
      if (results.length) {
        const hit = this._readPose(results[0], this.referenceSpace);
        if (hit) {
          const ay = Math.abs(hit.ny);
          const ax = Math.abs(hit.nx);
          const az = Math.abs(hit.nz);
          if (ay > ax && ay > az) {
            detections.floorY = hit.ny > 0 ? hit.py : detections.floorY;
          } else {
            detections.wallZ = hit.pz;
          }
        }
      }
    }

    // Suelo: rayo hacia abajo
    if (this.downSource) {
      let results = [];
      try { results = frame.getHitTestResults(this.downSource); } catch {}
      if (results.length) {
        const hit = this._readPose(results[0], this.referenceSpace);
        if (hit) detections.floorY = hit.py;
      }
    }

    if (detections.floorY === null && this.referenceSpace) {
      // 'local-floor' ya coloca el origen sobre el suelo (y = 0)
      detections.floorY = 0;
    }

    this.callbacks.onFrame?.(detections);
    return detections;
  }
}
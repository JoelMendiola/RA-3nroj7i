import * as THREE from 'three';
import { CONFIG } from './config.js';

export class SquareTracer {
  constructor(opts = {}) {
    this.minDist = opts.minDist ?? CONFIG.TRACER_MIN_DIST;
    this.turnAngle = opts.turnAngle ?? CONFIG.TRACER_TURN_ANGLE;
    this.closeDist = opts.closeDist ?? CONFIG.TRACER_CLOSE_DIST;
    this.reset();
  }

  reset() {
    this.pts = [];
    this.start = null;
    this.corners = [];
    this.dir = null;
    this.segmentDir = null;
    this.cooling = 0;
    this.closed = false;
  }

  add(x, y, z) {
    if (this.closed) return;

    if (this.pts.length === 0) {
      this.pts.push({ x, y, z });
      this.start = { x, y, z };
      return;
    }

    const last = this.pts[this.pts.length - 1];
    const dx = x - last.x;
    const dy = y - last.y;
    const dz = z - last.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < this.minDist) return;

    const rx = dx / d;
    const ry = dy / d;
    const rz = dz / d;

    let sx = rx;
    let sy = ry;
    let sz = rz;
    if (this.dir) {
      sx = this.dir.x * 0.5 + rx * 0.5;
      sy = this.dir.y * 0.5 + ry * 0.5;
      sz = this.dir.z * 0.5 + rz * 0.5;
      const l = Math.hypot(sx, sy, sz) || 1;
      sx /= l;
      sy /= l;
      sz /= l;
    }

    this.pts.push({ x, y, z });
    this.dir = { x: sx, y: sy, z: sz };

    if (this.cooling > 0) {
      this.cooling--;
    } else if (!this.segmentDir) {
      this.segmentDir = { x: sx, y: sy, z: sz };
    } else {
      const dot = sx * this.segmentDir.x + sy * this.segmentDir.y + sz * this.segmentDir.z;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > this.turnAngle) {
        this.corners.push({ x, y, z });
        this.segmentDir = { x: rx, y: ry, z: rz };
        this.dir = { x: rx, y: ry, z: rz };
        this.cooling = 3;
      }
    }

    if (this.corners.length >= 3) {
      const dd = Math.hypot(x - this.start.x, y - this.start.y, z - this.start.z);
      if (dd < this.closeDist) this.closed = true;
    }
  }

  getVertices() {
    if (!this.start || this.corners.length < 3) return null;
    return [
      { x: this.start.x, y: this.start.y, z: this.start.z },
      ...this.corners.slice(-3),
    ];
  }
}

export class GuardianBoundary {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: CONFIG.GUARDIAN_TRACE_COLOR })
    );
    this.trailLine.frustumCulled = false;
    this.trailLine.visible = false;
    this.group.add(this.trailLine);

    this.squareLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: CONFIG.GUARDIAN_TRACE_COLOR })
    );
    this.squareLine.frustumCulled = false;
    this.squareLine.visible = false;
    this.group.add(this.squareLine);

    this.fence = new THREE.Group();
    this.fence.visible = false;
    this.group.add(this.fence);
  }

  _setLine(line, pts) {
    const arr = [];
    for (const p of pts) arr.push(p.x, p.y, p.z);
    line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    line.visible = arr.length >= 6;
  }

  updateTrail(pts) {
    if (!pts || pts.length < 2) {
      this.trailLine.visible = false;
      return;
    }
    this._setLine(this.trailLine, pts);
  }

  updateSquare(vertices) {
    if (!vertices || vertices.length < 2) {
      this.squareLine.visible = false;
      return;
    }
    const closed = [ ...vertices, vertices[0] ];
    this._setLine(this.squareLine, closed);
  }

  confirm(vertices) {
    const h = CONFIG.GUARDIAN_FENCE_HEIGHT;
    const avgY = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
    const p = vertices.map((v) => new THREE.Vector3(v.x, avgY, v.z));

    // cerrar el cuadrado (rojo -> verde)
    this.updateSquare(vertices.map((v) => ({ x: v.x, y: avgY, z: v.z })));
    this.squareLine.material.color.setHex(CONFIG.GUARDIAN_DONE_COLOR);
    this.trailLine.visible = false;

    while (this.fence.children.length) {
      const c = this.fence.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
      this.fence.remove(c);
    }

    // Área del suelo (cuadrilátero translúcido)
    const shape = new THREE.Shape(p.map((v) => new THREE.Vector2(v.x, v.z)));
    const area = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: CONFIG.GUARDIAN_DONE_COLOR,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    area.rotation.x = -Math.PI / 2;
    area.position.y = avgY + 0.001;
    this.fence.add(area);

    // Borde superior + postes verticales
    const top = p.map((v) => v.clone().setY(avgY + h));
    const edgePts = [];
    for (let i = 0; i < p.length; i++) edgePts.push(top[i], top[(i + 1) % p.length]);
    const topLoop = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: CONFIG.GUARDIAN_DONE_COLOR })
    );
    topLoop.frustumCulled = false;
    const topArr = [];
    for (const v of edgePts) topArr.push(v.x, v.y, v.z);
    topLoop.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(topArr), 3));
    this.fence.add(topLoop);

    const postArr = [];
    for (const v of p) postArr.push(v.x, v.y, v.z, v.x, v.y + h, v.z);
    const posts = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: CONFIG.GUARDIAN_DONE_COLOR })
    );
    posts.frustumCulled = false;
    posts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(postArr), 3));
    this.fence.add(posts);

    this.fence.visible = true;
  }
}
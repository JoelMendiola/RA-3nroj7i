import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG, clamp } from './config.js';
import { addPlaneBody } from './physics.js';

const LEFT_RIGHT = 1.2;
const FRONT_BACK = -0.25;
const CEIL_Y = 2.6;
const FLOOR_THICKNESS = 0.1;

export class Surfaces {
  constructor(scene, world, surfaceMat) {
    this.scene = scene;
    this.world = world;
    this.material = surfaceMat;
    this.floorY = CONFIG.INITIAL_FLOOR_Y;
    this.wallZ = CONFIG.INITIAL_WALL_Z;
    this.guidesVisible = true;
    this.floorBounded = false;
    this.floorBounds = null;
    this.floorThickness = FLOOR_THICKNESS;
    this.floorOutline = null;
    this.drawPreview = null;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.floorBody = addPlaneBody(world, surfaceMat, [0, this.floorY, 0], [-Math.PI / 2, 0, 0]);
    this.wallBody = addPlaneBody(world, surfaceMat, [0, 0, this.wallZ], [0, 0, 0]);

    this.sides = [
      this._addWall(world, surfaceMat, [-LEFT_RIGHT, 0, 0], [0, Math.PI / 2, 0]), // izquierda: normal +X
      this._addWall(world, surfaceMat, [LEFT_RIGHT, 0, 0], [0, -Math.PI / 2, 0]), // derecha: normal -X
      this._addWall(world, surfaceMat, [0, 0, FRONT_BACK], [0, Math.PI, 0]), // frontal: normal -Z
      this._addWall(world, surfaceMat, [0, CEIL_Y, 0], [Math.PI / 2, 0, 0]), // techo: normal -Y
    ];

    this.floorGuide = this._makeGuide('floor', [0, this.floorY, 0], [-Math.PI / 2, 0, 0]);
    this.wallGuide = this._makeGuide('wall', [0, 0, this.wallZ], [0, 0, 0]);
  }

  _addWall(world, surfaceMat, position, euler) {
    const body = addPlaneBody(world, surfaceMat, position, euler);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 6),
      new THREE.MeshBasicMaterial({ color: CONFIG.SURFACE_COLOR, visible: false })
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(euler[0], euler[1], euler[2]);
    mesh.visible = false;
    mesh.userData.isSurface = true;
    this.group.add(mesh);

    return { body, mesh };
  }

  _makeGuide(kind, position, euler) {
    const group = new THREE.Group();
    const grid = new THREE.GridHelper(6, 12, CONFIG.SURFACE_COLOR, 0x1f5c3a);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({
        color: CONFIG.SURFACE_COLOR,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );

    if (kind === 'floor') {
      grid.position.y = 0.002;
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.001;
    } else {
      grid.rotation.x = Math.PI / 2;
      plane.rotation.y = Math.PI;
    }

    group.add(grid, plane);
    group.position.set(position[0], position[1], position[2]);
    group.rotation.set(euler[0], euler[1], euler[2]);
    this.group.add(group);
    return group;
  }

  _updateFloorOutline() {
    if (!this.floorOutline) {
      this.floorOutline = new THREE.LineLoop(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
      );
      this.floorOutline.position.y = this.floorY;
      this.group.add(this.floorOutline);
    }
    const { cx, cz, halfW, halfD } = this.floorBounds;
    const pts = [
      new THREE.Vector3(cx - halfW, 0, cz - halfD),
      new THREE.Vector3(cx + halfW, 0, cz - halfD),
      new THREE.Vector3(cx + halfW, 0, cz + halfD),
      new THREE.Vector3(cx - halfW, 0, cz + halfD),
    ];
    this.floorOutline.geometry.setFromPoints(pts);
    this.floorOutline.position.y = this.floorY;
    this.floorOutline.visible = this.guidesVisible;
  }

  setFloorY(y) {
    this.floorY = clamp(y, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX);
    this.floorBody.position.y = this.floorY - (this.floorBounded ? this.floorThickness : 0);
    this.floorBody.aabbNeedsUpdate = true;
    this.floorGuide.position.y = this.floorY;
    if (this.floorOutline) this.floorOutline.position.y = this.floorY;
  }

  // Registra el cuadrado dibujado como colisionador de referencia (suelo acotado).
  setBoundedFloor(cx, cz, halfW, halfD, y) {
    this.floorY = clamp(y, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX);
    this.floorBounded = true;
    this.floorBounds = { cx, cz, halfW, halfD };

    this.world.removeBody(this.floorBody);

    const shape = new CANNON.Box(new CANNON.Vec3(halfW, this.floorThickness, halfD));
    const body = new CANNON.Body({ mass: 0, material: this.material, type: CANNON.Body.STATIC });
    body.addShape(shape);
    body.position.set(cx, this.floorY - this.floorThickness, cz);
    body.aabbNeedsUpdate = true;
    this.world.addBody(body);
    this.floorBody = body;

    this.floorGuide.position.y = this.floorY;
    this._updateFloorOutline();
  }

  restoreInfiniteFloor(y) {
    this.floorY = clamp(y, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX);
    this.floorBounded = false;
    this.floorBounds = null;

    this.world.removeBody(this.floorBody);
    this.floorBody = addPlaneBody(this.world, this.material, [0, this.floorY, 0], [-Math.PI / 2, 0, 0]);

    this.floorGuide.position.y = this.floorY;
    if (this.floorOutline) this.floorOutline.visible = false;
  }

  setWallZ(z) {
    this.wallZ = clamp(z, CONFIG.WALL_MIN, CONFIG.WALL_MAX);
    this.wallBody.position.z = this.wallZ;
    this.wallBody.aabbNeedsUpdate = true;
    this.wallGuide.position.z = this.wallZ;
  }

  setFloorDrawPreview(a, b, y) {
    if (!this.drawPreview) {
      this.drawPreview = new THREE.LineLoop(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95 })
      );
      this.group.add(this.drawPreview);
    }
    const pts = [
      new THREE.Vector3(a.x, 0, a.z),
      new THREE.Vector3(b.x, 0, a.z),
      new THREE.Vector3(b.x, 0, b.z),
      new THREE.Vector3(a.x, 0, b.z),
    ];
    this.drawPreview.geometry.setFromPoints(pts);
    this.drawPreview.position.y = y;
    this.drawPreview.visible = true;
  }

  clearFloorDrawPreview() {
    if (this.drawPreview) this.drawPreview.visible = false;
  }

  setGuidesVisible(v) {
    this.guidesVisible = v;
    this.floorGuide.visible = v;
    this.wallGuide.visible = v;
    if (this.floorOutline) this.floorOutline.visible = v && this.floorBounded;
  }
}
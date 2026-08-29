import * as THREE from 'three';
import { CONFIG, clamp } from './config.js';
import { addPlaneBody } from './physics.js';

const LEFT_RIGHT = 1.2;
const FRONT_BACK = -0.25;
const CEIL_Y = 2.6;

export class Surfaces {
  constructor(scene, world, surfaceMat) {
    this.scene = scene;
    this.world = world;
    this.material = surfaceMat;
    this.floorY = CONFIG.INITIAL_FLOOR_Y;
    this.wallZ = CONFIG.INITIAL_WALL_Z;
    this.guidesVisible = true;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.floorBody = addPlaneBody(world, surfaceMat, [0, this.floorY, 0], [-Math.PI / 2, 0, 0]);
    this.wallBody = addPlaneBody(world, surfaceMat, [0, 0, this.wallZ], [0, 0, 0]);

    this.sides = [
      this._addWall(world, surfaceMat, [-LEFT_RIGHT, 0, 0], [0, Math.PI / 2, 0]),
      this._addWall(world, surfaceMat, [LEFT_RIGHT, 0, 0], [0, -Math.PI / 2, 0]),
      this._addWall(world, surfaceMat, [0, 0, FRONT_BACK], [0, Math.PI, 0]),
      this._addWall(world, surfaceMat, [0, CEIL_Y, 0], [Math.PI / 2, 0, 0]),
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

  setFloorY(y) {
    this.floorY = clamp(y, CONFIG.FLOOR_MIN, CONFIG.FLOOR_MAX);
    this.floorBody.position.y = this.floorY;
    this.floorBody.aabbNeedsUpdate = true;
    this.floorGuide.position.y = this.floorY;
  }

  setWallZ(z) {
    this.wallZ = clamp(z, CONFIG.WALL_MIN, CONFIG.WALL_MAX);
    this.wallBody.position.z = this.wallZ;
    this.wallBody.aabbNeedsUpdate = true;
    this.wallGuide.position.z = this.wallZ;
  }

  setGuidesVisible(v) {
    this.guidesVisible = v;
    this.floorGuide.visible = v;
    this.wallGuide.visible = v;
  }

  setWallGuideVisible(v) {
    this.wallGuide.visible = v;
  }
}
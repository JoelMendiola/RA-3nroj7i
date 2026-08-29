import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

export function createWorld() {
  const world = new CANNON.World();
  world.gravity.set(0, CONFIG.GRAVITY, 0);
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);

  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.55;
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 3;

  const ballMat = new CANNON.Material('ball');
  const surfaceMat = new CANNON.Material('surface');

  const ballSurface = new CANNON.ContactMaterial(surfaceMat, ballMat, {
    friction: 0.25,
    restitution: 0.72,
    contactEquationStiffness: 1e8,
    contactEquationRelaxation: 3,
  });
  world.addContactMaterial(ballSurface);

  return { world, ballMat, surfaceMat };
}

export function addPlaneBody(world, material, position, euler) {
  const shape = new CANNON.Plane();
  const body = new CANNON.Body({ mass: 0, material, type: CANNON.Body.STATIC });
  body.addShape(shape);
  body.quaternion.setFromEuler(euler[0], euler[1], euler[2]);
  body.position.set(position[0], position[1], position[2]);
  body.collisionResponse = true;
  world.addBody(body);
  return body;
}

export function createDynamicBody(world, material, shape, position) {
  const body = new CANNON.Body({
    mass: 1,
    material,
    type: CANNON.Body.DYNAMIC,
    position: new CANNON.Vec3(position.x, position.y, position.z),
  });
  body.addShape(shape);
  body.linearDamping = 0.02;
  body.angularDamping = 0.05;
  body.sleepSpeedLimit = 0.4;
  body.sleepTimeLimit = 0.8;
  world.addBody(body);
  return body;
}

export function syncMeshToBody(mesh, body) {
  mesh.position.copy(body.position);
  mesh.quaternion.copy(body.quaternion);
}
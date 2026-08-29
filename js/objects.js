import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { randomColorHex } from './config.js';
import { createDynamicBody } from './physics.js';

let objectId = 0;

export function spawnObject(scene, world, ballMat, position, velocity, kind) {
  const isSphere = kind ? kind === 'sphere' : Math.random() < 0.5;

  let geometry;
  let shape;
  let radius;

  if (isSphere) {
    radius = 0.09;
    geometry = new THREE.SphereGeometry(radius, 28, 18);
    shape = new CANNON.Sphere(radius);
  } else {
    radius = 0.11;
    const half = radius;
    geometry = new THREE.BoxGeometry(half * 2, half * 2, half * 2);
    shape = new CANNON.Box(new CANNON.Vec3(half, half, half));
  }

  const material = new THREE.MeshStandardMaterial({
    color: randomColorHex(),
    roughness: 0.35,
    metalness: 0.15,
    emissive: 0x000000,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const body = createDynamicBody(world, ballMat, shape, position);
  if (velocity) {
    body.velocity.set(velocity.x, velocity.y, velocity.z);
  }

  scene.add(mesh);

  const obj = {
    id: objectId++,
    kind: isSphere ? 'sphere' : 'box',
    radius,
    mesh,
    body,
    heldBy: -1,
    originalColor: material.color.getHex(),
  };

  sync(obj);
  return obj;
}

export function sync(obj) {
  obj.mesh.position.copy(obj.body.position);
  obj.mesh.quaternion.copy(obj.body.quaternion);
}

export function grabObject(obj, handIndex) {
  obj.heldBy = handIndex;
  obj.storedMass = obj.body.mass;
  obj.body.type = CANNON.Body.KINEMATIC;
  obj.body.velocity.setZero();
  obj.body.angularVelocity.setZero();
  obj.mesh.material.emissive.setHex(0x35e07f);
  obj.mesh.material.emissiveIntensity = 0.6;
}

export function holdObject(obj, handPos) {
  obj.body.position.copy(handPos);
  obj.body.velocity.setZero();
  obj.body.angularVelocity.setZero();
  obj.body.aabbNeedsUpdate = true;
  obj.body.wakeUp();
}

export function releaseObject(obj, hand) {
  obj.body.type = CANNON.Body.DYNAMIC;
  obj.body.mass = obj.storedMass ?? 1;
  obj.body.updateMassProperties();
  obj.body.velocity.copy(hand.velocity);
  obj.body.angularVelocity.set(
    (Math.random() - 0.5) * 3,
    (Math.random() - 0.5) * 3,
    (Math.random() - 0.5) * 3
  );
  obj.body.wakeUp();
  obj.heldBy = -1;
  obj.mesh.material.emissive.setHex(0x000000);
  obj.mesh.material.emissiveIntensity = 0;
}
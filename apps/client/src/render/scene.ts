import * as THREE from 'three';
import { WORLD_SIZE } from '@town/shared';

/** Warm coastal-afternoon base scene: sky, sun, flat ground. Chunks add props on top. */
export function createScene(): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6c98b');
  scene.fog = new THREE.Fog('#f6c98b', 120, 380);

  scene.add(new THREE.HemisphereLight('#ffe8c2', '#b8794a', 1.1));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
  sun.shadow.camera.right = sun.shadow.camera.top = 60;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshStandardMaterial({ color: '#d9b27c', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  return { scene, sun };
}

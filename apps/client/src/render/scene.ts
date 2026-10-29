import * as THREE from 'three';
import { WORLD_SIZE } from '@town/shared';

const SHADOW_RANGE = 50;

/** Warm coastal-afternoon base scene: sky, sun, sand ground, sea to the south. */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6c98b');
  scene.fog = new THREE.Fog('#f6c98b', 90, 260);

  scene.add(new THREE.HemisphereLight('#ffe8c2', '#b8794a', 1.3));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -SHADOW_RANGE;
  sun.shadow.camera.right = sun.shadow.camera.top = SHADOW_RANGE;
  sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Flat terrain (town.json terrain.type = 'flat'), extended past the town edge to the shore.
  const pad = 120;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE + pad * 2, WORLD_SIZE + pad),
    new THREE.MeshStandardMaterial({ color: '#d9b27c', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD_SIZE / 2, -0.01, WORLD_SIZE / 2 - pad / 2 + 20);
  ground.receiveShadow = true;

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 4, 600),
    new THREE.MeshStandardMaterial({ color: '#2f9aa8', roughness: 0.25, metalness: 0.1 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(WORLD_SIZE / 2, -0.3, WORLD_SIZE + 20 + 300);
  scene.add(ground, sea);

  /** Keep the shadow frustum on the player so shadows exist wherever they walk. */
  const follow = (p: THREE.Vector3) => {
    sun.target.position.set(p.x, 0, p.z);
    sun.position.set(p.x + 60, 90, p.z + 30);
  };
  return { scene, sun, follow };
}

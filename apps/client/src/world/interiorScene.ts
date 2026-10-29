import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { InteriorDef } from '@town/shared';

/**
 * Builds an interior sub-scene: every box merged into one vertex-coloured mesh (one draw call),
 * plus its lights, positioned at the interior's origin.
 */
export function buildInterior(def: InteriorDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `interior:${def.id}`;
  group.position.set(...def.origin);

  const color = new THREE.Color();
  const parts = def.boxes.map((b) => {
    const g = new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2);
    g.translate(b.pos[0], b.pos[1], b.pos[2]);
    color.set(b.color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (merged) {
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const l of def.lights) {
    const light = new THREE.PointLight(l.color, l.intensity, 14, 1.6);
    light.position.set(...l.pos);
    group.add(light);
  }
  return group;
}

export function disposeInterior(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

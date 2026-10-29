import * as THREE from 'three';
import { PLAYER, lerp, lerpAngle, type PlayerState } from '@town/shared';

interface View {
  mesh: THREE.Mesh;
  target: { x: number; y: number; z: number; yaw: number };
}

const SMOOTH_PER_SECOND = 12;

/**
 * Cosmetic player views. Deliverable 1 renders everyone from server state with simple
 * smoothing; deliverable 7 swaps this for prediction (local) + 100 ms interpolation (remote).
 */
export class PlayerViews {
  private views = new Map<string, View>();
  private geo = new THREE.CapsuleGeometry(PLAYER.capsuleRadius, PLAYER.capsuleHalfHeight * 2, 4, 8);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly localId: string,
  ) {}

  upsert(id: string, s: PlayerState): void {
    let v = this.views.get(id);
    if (!v) {
      const color = id === this.localId ? '#e2572b' : '#2b7de2';
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color }));
      mesh.castShadow = true;
      mesh.position.set(s.x, s.y, s.z);
      this.scene.add(mesh);
      v = { mesh, target: { x: s.x, y: s.y, z: s.z, yaw: s.yaw } };
      this.views.set(id, v);
    }
    Object.assign(v.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.mesh);
    (v.mesh.material as THREE.Material).dispose();
    this.views.delete(id);
  }

  render(dt: number): void {
    const k = 1 - Math.exp(-SMOOTH_PER_SECOND * dt);
    const footOffset = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
    for (const v of this.views.values()) {
      const p = v.mesh.position;
      p.set(
        lerp(p.x, v.target.x, k),
        lerp(p.y - footOffset, v.target.y, k) + footOffset,
        lerp(p.z, v.target.z, k),
      );
      v.mesh.rotation.y = lerpAngle(v.mesh.rotation.y, v.target.yaw, k);
    }
  }

  get size(): number {
    return this.views.size;
  }

  get(id: string): THREE.Object3D | undefined {
    return this.views.get(id)?.mesh;
  }
}

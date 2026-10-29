import * as THREE from 'three';
import { clamp } from '@town/shared';

/**
 * Minimal third-person follow camera with mouse-drag orbit. Deliverable 2 adds pointer
 * lock and collision-aware boom shortening against the Rapier world.
 */
export class FollowCamera {
  yaw = 0;
  pitch = -0.25;
  distance = 6;
  private dragging = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    el: HTMLElement,
  ) {
    el.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = clamp(this.pitch - e.movementY * 0.005, -1.2, 0.4);
    });
  }

  update(target: THREE.Vector3): void {
    const c = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * c,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * c,
    );
    this.camera.position
      .copy(target)
      .addScaledVector(offset, this.distance)
      .add(new THREE.Vector3(0, 1.2, 0));
    this.camera.lookAt(target.x, target.y + 1.2, target.z);
  }
}

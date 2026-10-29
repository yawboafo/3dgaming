import * as THREE from 'three';
import { clamp } from '@town/shared';
import type { ClientPhysics } from '../physics/clientPhysics.js';

const PIVOT_HEIGHT = 1.6;
const MIN_PITCH = -1.2;
const MAX_PITCH = 0.5;
const SENSITIVITY = 0.0025;
const MARGIN = 0.25;

/**
 * Third-person orbit camera. Click to pointer-lock; mouse orbits, wheel zooms. The boom is
 * shortened with a Rapier ray-cast so walls never come between camera and player.
 */
export class OrbitCamera {
  yaw = 0;
  pitch = -0.3;
  distance = 5;
  private boom = 5;
  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly el: HTMLElement,
    private readonly physics: ClientPhysics,
  ) {
    el.addEventListener('click', () => {
      if (document.pointerLockElement !== el) void el.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = clamp(this.pitch - e.movementY * SENSITIVITY, MIN_PITCH, MAX_PITCH);
    });
    el.addEventListener('wheel', (e) => {
      this.distance = clamp(this.distance + Math.sign(e.deltaY) * 0.5, 2, 10);
    });
  }

  update(target: THREE.Vector3, dt: number): void {
    this.pivot.set(target.x, target.y + PIVOT_HEIGHT, target.z);
    const c = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * c, -Math.sin(this.pitch), Math.cos(this.yaw) * c).normalize();
    const free = this.physics.castRay(this.pivot, this.dir, this.distance + MARGIN) - MARGIN;
    // Snap in immediately when blocked, ease back out when clear.
    this.boom = free < this.boom ? free : lerpTo(this.boom, free, dt * 4);
    this.camera.position.copy(this.pivot).addScaledVector(this.dir, Math.max(0.3, this.boom));
    this.camera.lookAt(this.pivot);
  }
}

const lerpTo = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);

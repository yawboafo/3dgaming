import * as THREE from 'three';
import { clamp } from '@town/shared';
import type { ClientPhysics } from '../physics/clientPhysics.js';

const PIVOT_HEIGHT = 1.6;
const MIN_PITCH = -1.2;
const MAX_PITCH = 0.5;
const SENSITIVITY = 0.0025;
const MARGIN = 0.25;
/** After this long without mouse input, the chase camera swings back behind the vehicle. */
const CHASE_IDLE_S = 1.2;

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
  private sinceMouse = Infinity;
  /** Set while driving: heading to sit behind (camera yaw convention) and preferred boom. */
  chase?: { yaw: number; distance: number; height: number };
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
      this.sinceMouse = 0;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = clamp(this.pitch - e.movementY * SENSITIVITY, MIN_PITCH, MAX_PITCH);
    });
    el.addEventListener('wheel', (e) => {
      this.distance = clamp(this.distance + Math.sign(e.deltaY) * 0.5, 2, 10);
    });
  }

  update(target: THREE.Vector3, dt: number): void {
    this.sinceMouse += dt;
    const chase = this.chase;
    if (chase && this.sinceMouse > CHASE_IDLE_S) {
      let d = (chase.yaw - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 2.5);
      this.pitch += (-0.25 - this.pitch) * Math.min(1, dt * 2);
    }
    const want = chase ? chase.distance : this.distance;
    this.pivot.set(target.x, target.y + (chase ? chase.height : PIVOT_HEIGHT), target.z);
    const c = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * c, -Math.sin(this.pitch), Math.cos(this.yaw) * c).normalize();
    const free = this.physics.castRay(this.pivot, this.dir, want + MARGIN) - MARGIN;
    // Snap in immediately when blocked, ease back out when clear.
    this.boom = free < this.boom ? free : lerpTo(this.boom, free, dt * 4);
    this.camera.position.copy(this.pivot).addScaledVector(this.dir, Math.max(0.3, this.boom));
    this.camera.lookAt(this.pivot);
  }
}

const lerpTo = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);

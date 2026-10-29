import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, WORLD_SIZE } from '@town/shared';

let ready: Promise<void> | undefined;

/** Rapier's WASM must initialise once per process before any world is created. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Headless authoritative physics world for one room. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  lastStepMs = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    // Flat ground slab covering the whole town; chunk colliders get added on top.
    const half = WORLD_SIZE / 2;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(half, -0.5, half),
    );
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.world.timestep = dt;
    this.world.step();
    this.lastStepMs = performance.now() - t0;
  }

  dispose(): void {
    this.world.free();
  }
}

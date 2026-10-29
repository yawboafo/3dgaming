import RAPIER from '@dimforge/rapier3d-compat';
import {
  CharacterMotor,
  GRAVITY,
  addChunkColliders,
  addInteriorColliders,
  addWorldBounds,
  type InteriorDef,
  type WorldDef,
} from '@town/shared';

let ready: Promise<void> | undefined;

/** Rapier's WASM must initialise once per process before any world is created. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Headless authoritative physics world for one room: every chunk and interior, always loaded. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly motor: CharacterMotor;
  lastStepMs = 0;
  /** Worst step since the last stats report. */
  maxStepMs = 0;

  constructor(town: WorldDef, interiors: InteriorDef[]) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    addWorldBounds(RAPIER, this.world);
    for (const chunk of town.chunks) addChunkColliders(RAPIER, this.world, chunk);
    // Interiors sit far outside the town in the same world, so entering is just a teleport.
    for (const interior of interiors) addInteriorColliders(RAPIER, this.world, interior);
    this.world.step(); // build the broad phase before the first character query
    this.motor = new CharacterMotor(RAPIER, this.world);
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.world.timestep = dt;
    this.world.step();
    this.lastStepMs = performance.now() - t0;
    this.maxStepMs = Math.max(this.maxStepMs, this.lastStepMs);
  }

  dispose(): void {
    this.world.free();
  }
}

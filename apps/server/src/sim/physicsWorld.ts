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
  /** Wall time of each tick's physics since the last stats report. */
  private samples: number[] = [];

  constructor(town: WorldDef, interiors: InteriorDef[]) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    addWorldBounds(RAPIER, this.world);
    for (const chunk of town.chunks) addChunkColliders(RAPIER, this.world, chunk);
    // Interiors sit far outside the town in the same world, so entering is just a teleport.
    for (const interior of interiors) addInteriorColliders(RAPIER, this.world, interior);
    this.world.step(); // build the broad phase before the first character query
    this.motor = new CharacterMotor(RAPIER, this.world);
  }

  /** One server tick of physics: `subSteps` world steps, with `beforeEach` (vehicle controllers). */
  step(subDt: number, subSteps: number, beforeEach: (subDt: number) => void = () => {}): void {
    const t0 = performance.now();
    this.world.timestep = subDt;
    for (let i = 0; i < subSteps; i++) {
      beforeEach(subDt);
      this.world.step();
    }
    // Budgets are per physics step (60 Hz), so record the average step within this tick.
    this.samples.push((performance.now() - t0) / Math.max(1, subSteps));
  }

  /**
   * p95 and worst tick since the last call. The p95 is the budget figure: the worst case is
   * dominated by GC pauses and OS scheduling, not by Rapier.
   */
  takeStats(): { p95: number; max: number } {
    const s = this.samples.sort((a, b) => a - b);
    this.samples = [];
    if (s.length === 0) return { p95: 0, max: 0 };
    return { p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!, max: s[s.length - 1]! };
  }

  dispose(): void {
    this.world.free();
  }
}

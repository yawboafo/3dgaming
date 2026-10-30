import { matchMaker } from 'colyseus';
import type { ServerStats } from '@town/shared';
import type { PhysicsWorld } from '../sim/physicsWorld.js';

/** Per-second diagnostics for the /debug overlay and the load test. */
export class RoomStats {
  private ticks: number[] = [];

  /** Wall time of one whole tick (ms). */
  record(ms: number): void {
    this.ticks.push(ms);
  }

  take(physics: PhysicsWorld, players: number, zone: string): ServerStats {
    const { p95, max } = physics.takeStats();
    const t = this.ticks.sort((a, b) => a - b);
    this.ticks = [];
    return {
      physicsStepMs: p95,
      physicsStepMaxMs: max,
      tickMs: t[Math.floor(t.length * 0.95)] ?? 0,
      players,
      zone,
      processId: matchMaker.processId,
    };
  }
}

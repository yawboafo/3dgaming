import { Room, type Client } from 'colyseus';
import {
  InputSchema,
  MAX_PLAYERS_PER_ROOM,
  PlayerState,
  SERVER_TICK_HZ,
  SERVER_TICK_MS,
  TownState,
  isValidInput,
  movePlayer,
} from '@town/shared';
import { PhysicsWorld, initPhysics } from '../sim/physicsWorld.js';

/**
 * Authoritative town room. Phase 0 runs a single room for the whole town; zone rooms
 * (one per 2×2 chunk block) with border hand-off come in deliverable 7.
 */
export class TownRoom extends Room<{ state: TownState; input: InputSchema }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override state = new TownState();
  override inputs = this.defineInput(InputSchema, { seqField: 'seq', bufferMaxSize: 64 });
  private physics!: PhysicsWorld;
  private spawn: [number, number, number] = [224, 0, 224];

  override async onCreate(options: { spawn?: [number, number, number] } = {}) {
    await initPhysics();
    this.physics = new PhysicsWorld();
    if (options.spawn) this.spawn = options.spawn;
    this.patchRate = SERVER_TICK_MS;
    this.setFixedTimestep((ctx) => {
      for (const [sid, p] of this.state.players) {
        // Exactly one input per player per step: flooding inputs can't speed anyone up.
        // The fixed ctx.dt is used, never the client's claimed dt.
        const input = this.inputs.get(sid).next();
        if (input && isValidInput(input)) {
          movePlayer(p, input, ctx.dt);
          p.lastSeq = input.seq;
        }
      }
      this.physics.step(ctx.dt);
      this.state.tick = ctx.tick;
    }, SERVER_TICK_HZ);
  }

  override onJoin(client: Client, options: { name?: string } = {}) {
    const p = new PlayerState();
    p.name = (options.name ?? 'Guest').slice(0, 24);
    [p.x, p.y, p.z] = this.spawn;
    this.state.players.set(client.sessionId, p);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  override onDispose() {
    this.physics?.dispose();
  }
}

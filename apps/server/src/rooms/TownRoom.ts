import { Room, type Client } from 'colyseus';
import {
  InputSchema,
  MAX_PLAYERS_PER_ROOM,
  PlayerState,
  SERVER_TICK_HZ,
  SERVER_TICK_MS,
  ServerMsg,
  TownState,
  isValidInput,
  type ServerStats,
} from '@town/shared';
import { PhysicsWorld, initPhysics } from '../sim/physicsWorld.js';
import { loadTown } from '../sim/world.js';

/**
 * Authoritative town room. Phase 0 runs a single room for the whole town; zone rooms
 * (one per 2×2 chunk block) with border hand-off come in deliverable 7.
 */
export class TownRoom extends Room<{ state: TownState; input: InputSchema }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override state = new TownState();
  override inputs = this.defineInput(InputSchema, { seqField: 'seq', bufferMaxSize: 64 });
  private physics!: PhysicsWorld;
  private spawn: [number, number, number] = [0, 0, 0];

  override async onCreate() {
    await initPhysics();
    const town = loadTown();
    this.spawn = town.spawn;
    this.physics = new PhysicsWorld(town);
    this.patchRate = SERVER_TICK_MS;
    this.setFixedTimestep((ctx) => {
      // Exactly one input per player per step: flooding inputs can't speed anyone up.
      // The fixed ctx.dt is used, never the client's claimed dt.
      for (const [sid, p] of this.state.players) {
        const input = this.inputs.get(sid).next();
        if (input && isValidInput(input)) {
          this.physics.motor.move(sid, p, input, ctx.dt);
          p.lastSeq = input.seq;
        } else {
          this.physics.motor.move(sid, p, IDLE, ctx.dt); // keep gravity running
        }
      }
      this.physics.step(ctx.dt);
      this.state.tick = ctx.tick;
    }, SERVER_TICK_HZ);

    this.clock.setInterval(() => {
      const stats: ServerStats = {
        physicsStepMs: this.physics.maxStepMs,
        players: this.state.players.size,
      };
      this.physics.maxStepMs = 0;
      this.broadcast(ServerMsg.Stats, stats);
    }, 1000);
  }

  override onJoin(client: Client, options: { name?: string } = {}) {
    const p = new PlayerState();
    p.name = (options.name ?? 'Guest').slice(0, 24);
    // Spread spawns a little so simultaneous joiners don't start inside each other.
    const n = this.state.players.size;
    p.x = this.spawn[0] + (n % 4) * 1.2;
    p.y = this.spawn[1];
    p.z = this.spawn[2] + Math.floor(n / 4) * 1.2;
    this.state.players.set(client.sessionId, p);
    this.physics.motor.add(client.sessionId, p);
  }

  override onLeave(client: Client) {
    this.physics.motor.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose() {
    this.physics?.dispose();
  }
}

const IDLE = { seq: 0, dt: 0, keys: 0, yaw: 0, pitch: 0 };

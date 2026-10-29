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
import { InteractionSystem } from '../sim/interactions.js';
import { PhysicsWorld, initPhysics } from '../sim/physicsWorld.js';
import { VehicleSystem } from '../sim/vehicles.js';
import { loadInteriors, loadTown, loadVehicles } from '../sim/world.js';

/**
 * Authoritative town room. Phase 0 runs a single room for the whole town; zone rooms
 * (one per 2×2 chunk block) with border hand-off come in deliverable 7.
 */
export class TownRoom extends Room<{ state: TownState; input: InputSchema }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override state = new TownState();
  override inputs = this.defineInput(InputSchema, { seqField: 'seq', bufferMaxSize: 64 });
  private physics!: PhysicsWorld;
  private interactions!: InteractionSystem;
  private vehicles!: VehicleSystem;
  private spawn: [number, number, number] = [0, 0, 0];
  private spawnYaw = 0;

  override async onCreate() {
    await initPhysics();
    const town = loadTown();
    const interiors = loadInteriors(town);
    this.spawn = town.spawn;
    this.spawnYaw = town.spawnYaw;
    this.physics = new PhysicsWorld(town, interiors);
    this.interactions = new InteractionSystem(town, interiors, this.physics.motor);
    this.vehicles = new VehicleSystem(
      this.physics.world,
      loadVehicles(),
      town,
      this.state,
      this.interactions.ecs,
      this.physics.motor,
    );
    this.interactions.attachVehicles(this.vehicles);
    this.patchRate = SERVER_TICK_MS;
    this.setFixedTimestep(
      (ctx) => {
        // Exactly one input per player per step: flooding inputs can't speed anyone up.
        // The fixed ctx.dt is used, never the client's claimed dt.
        for (const [sid, p] of this.state.players) {
          const input = this.inputs.get(sid).next();
          const frame = input && isValidInput(input) ? input : IDLE; // idle keeps gravity running
          if (p.vehicle) this.vehicles.setKeys(p.vehicle, frame.keys);
          else this.physics.motor.move(sid, p, frame, ctx.dt);
          if (frame !== IDLE) {
            // A gap in input must not look like "E released", or holding E would re-trigger.
            this.interactions.update(sid, p, frame.keys);
            p.lastSeq = frame.seq;
          }
        }
        this.vehicles.drive(ctx.dt);
        this.physics.step(ctx.subDt, ctx.subSteps, (dt) => this.vehicles.update(dt));
        this.vehicles.writeState();
        this.state.tick = ctx.tick;
      },
      SERVER_TICK_HZ,
      { subSteps: PHYSICS_SUBSTEPS },
    );

    this.clock.setInterval(() => {
      const { p95, max } = this.physics.takeStats();
      const stats: ServerStats = {
        physicsStepMs: p95,
        physicsStepMaxMs: max,
        players: this.state.players.size,
      };
      this.broadcast(ServerMsg.Stats, stats);
    }, 1000);
  }

  override onJoin(client: Client, options: { name?: string } = {}) {
    const p = new PlayerState();
    p.name = (options.name ?? 'Guest').slice(0, 24);
    // Spread simultaneous joiners either side of the spawn (0, +1.2, -1.2, +2.4 …) so they don't
    // start inside each other and the first few are still within the first door's range.
    const n = this.state.players.size;
    const side = n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2);
    p.x = this.spawn[0] + side * 1.2;
    p.y = this.spawn[1];
    p.z = this.spawn[2];
    p.yaw = this.spawnYaw;
    this.state.players.set(client.sessionId, p);
    this.physics.motor.add(client.sessionId, p);
  }

  override onLeave(client: Client) {
    this.physics.motor.remove(client.sessionId);
    this.interactions.forget(client.sessionId);
    this.vehicles.release(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose() {
    this.physics?.dispose();
  }
}

/** Vehicles need finer integration than 20 Hz; inputs stay one per tick. */
const PHYSICS_SUBSTEPS = 3;

const IDLE = { seq: 0, dt: 0, keys: 0, yaw: 0, pitch: 0 };

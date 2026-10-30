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
  type InputFrame,
  type ServerStats,
} from '@town/shared';
import { HitRegistry } from '../sim/hits.js';
import { InteractionSystem } from '../sim/interactions.js';
import { PhysicsWorld, initPhysics } from '../sim/physicsWorld.js';
import { PropSystem } from '../sim/props.js';
import { VehicleSystem } from '../sim/vehicles.js';
import { WeaponSystem } from '../sim/weapons.js';
import { loadInteriors, loadTown, loadVehicles, loadWeapons } from '../sim/world.js';

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
  private weapons!: WeaponSystem;
  private readonly hits = new HitRegistry();
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
    for (const [id, c] of this.vehicles.colliders())
      this.hits.add(c.handle, { kind: 'vehicle', id });

    const weaponCatalog = loadWeapons();
    new PropSystem(this.physics.world, town, weaponCatalog, this.state, this.hits);
    this.weapons = new WeaponSystem(
      this.physics.world,
      weaponCatalog.weapons,
      this.state,
      this.hits,
      {
        colliderOf: (sid) => this.physics.motor.collider(sid),
        broadcast: (e) => this.broadcast(ServerMsg.Shot, e),
        killed: (sid, p) => {
          if (p.vehicle) this.vehicles.eject(sid, p);
        },
      },
    );

    this.patchRate = SERVER_TICK_MS;
    this.setFixedTimestep(
      (ctx) => this.tick(ctx.tick * ctx.dt, ctx.dt, ctx.subDt, ctx.subSteps),
      SERVER_TICK_HZ,
      {
        subSteps: PHYSICS_SUBSTEPS,
      },
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

  private tick(now: number, dt: number, subDt: number, subSteps: number): void {
    this.weapons.now = now;
    // Exactly one input per player per step: flooding inputs can't speed anyone up.
    // The fixed dt is used, never the client's claimed dt.
    for (const [sid, p] of this.state.players) {
      const input = this.inputs.get(sid).next();
      const valid: InputFrame = input && isValidInput(input) ? input : IDLE;
      // Idle keeps gravity running; the dead don't act until they respawn.
      const frame = p.health === 0 ? { ...IDLE, seq: valid.seq } : valid;
      if (p.vehicle) this.vehicles.setKeys(p.vehicle, frame.keys);
      else this.physics.motor.move(sid, p, frame, dt);
      if (valid !== IDLE) {
        // A gap in input must not look like "E released", or holding E would re-trigger.
        this.interactions.update(sid, p, frame.keys);
        this.weapons.update(sid, p, frame, now);
        p.lastSeq = frame.seq;
      }
    }
    this.vehicles.drive(dt);
    this.weapons.stepProjectiles(dt, now);
    this.physics.step(subDt, subSteps, (d) => this.vehicles.update(d));
    this.vehicles.writeState();
    for (const sid of this.weapons.respawns(now)) {
      const p = this.state.players.get(sid);
      if (p) {
        p.space = 'town';
        this.physics.motor.teleport(sid, p, ...this.spawn, this.spawnYaw);
      }
    }
    this.state.tick = Math.round(now / dt);
  }

  override onJoin(client: Client, options: { name?: string } = {}) {
    const sid = client.sessionId;
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
    this.state.players.set(sid, p);
    this.physics.motor.add(sid, p);
    this.weapons.join(sid, p);
    const capsule = this.physics.motor.collider(sid);
    if (capsule) {
      this.hits.add(capsule.handle, {
        kind: 'player',
        id: sid,
        damage: (amount) => this.weapons.damagePlayer(sid, amount, this.weapons.now),
      });
    }
  }

  override onLeave(client: Client) {
    const sid = client.sessionId;
    const capsule = this.physics.motor.collider(sid);
    if (capsule) this.hits.remove(capsule.handle);
    this.weapons.leave(sid);
    this.physics.motor.remove(sid);
    this.interactions.forget(sid);
    this.vehicles.release(sid);
    this.state.players.delete(sid);
  }

  override onDispose() {
    this.physics?.dispose();
  }
}

/** Vehicles need finer integration than 20 Hz; inputs stay one per tick. */
const PHYSICS_SUBSTEPS = 3;

const IDLE: InputFrame = { seq: 0, dt: 0, keys: 0, yaw: 0, pitch: 0 };

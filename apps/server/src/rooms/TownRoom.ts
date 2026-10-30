import { Room, type Client } from 'colyseus';
import {
  InputSchema,
  MAX_PLAYERS_PER_ROOM,
  PlayerState,
  SERVER_TICK_HZ,
  SERVER_TICK_MS,
  ServerMsg,
  TOWN_SPACE,
  TownState,
  inZone,
  isValidInput,
  zoneAt,
  zoneBounds,
  type InputFrame,
  type WorldDef,
} from '@town/shared';
import { claim, type HandoffPayload } from '../sim/handoff.js';
import { HitRegistry } from '../sim/hits.js';
import { InteractionSystem } from '../sim/interactions.js';
import { InterestManager } from '../sim/interest.js';
import { Navmesh } from '../sim/navmesh.js';
import { PedestrianSystem } from '../sim/pedestrians.js';
import { PhysicsWorld, initPhysics } from '../sim/physicsWorld.js';
import { PropSystem } from '../sim/props.js';
import { TrafficSystem } from '../sim/traffic.js';
import { VehicleSystem } from '../sim/vehicles.js';
import { WeaponSystem } from '../sim/weapons.js';
import { loadInteriors, loadTown, loadVehicles, loadWeapons } from '../sim/world.js';
import { RoomStats } from './roomStats.js';
import { ZoneBorder } from './zoneBorder.js';

/**
 * One zone of the town: a 2×2 chunk block (`zone` join option, matched with filterBy). The room
 * owns the vehicles, props, traffic loops and pedestrians in its zone, simulates them
 * authoritatively, sends each client only what's within 2 chunks of them, and hands players to the
 * neighbouring zone's room (possibly in another process, via Redis) when they cross the border.
 */
export class TownRoom extends Room<{ state: TownState; input: InputSchema }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override state = new TownState();
  override inputs = this.defineInput(InputSchema, { seqField: 'seq', bufferMaxSize: 64 });
  private physics!: PhysicsWorld;
  private interactions!: InteractionSystem;
  private vehicles!: VehicleSystem;
  private weapons!: WeaponSystem;
  private pedestrians!: PedestrianSystem;
  private traffic!: TrafficSystem;
  private interest!: InterestManager;
  private border!: ZoneBorder;
  private nav!: Navmesh;
  private readonly hits = new HitRegistry();
  private town!: WorldDef;
  private zone = '';
  private readonly stats = new RoomStats();

  override async onCreate(options: { zone?: string } = {}) {
    await initPhysics();
    const town = (this.town = loadTown());
    const interiors = loadInteriors(town);
    this.zone =
      options.zone && /^zone_\d+_\d+$/.test(options.zone)
        ? options.zone
        : zoneAt(town.spawn[0], town.spawn[2]);
    const bounds = zoneBounds(this.zone);
    const mine = (x: number, z: number) => inZone(bounds, x, z);
    const hasSpawn = mine(town.spawn[0], town.spawn[2]);

    this.physics = new PhysicsWorld(town, interiors);
    this.interactions = new InteractionSystem(town, interiors, this.physics.motor);
    const vehicleCatalog = loadVehicles();
    this.vehicles = new VehicleSystem(
      this.physics.world,
      vehicleCatalog,
      town.vehicles.filter((v) => mine(v.pos[0], v.pos[2])),
      this.state,
      this.interactions.ecs,
      this.physics.motor,
      this.zone,
    );
    this.interactions.attachVehicles(this.vehicles);
    for (const [id, c] of this.vehicles.colliders())
      this.hits.add(c.handle, { kind: 'vehicle', id });
    this.vehicles.onAdded = (id, c) => c && this.hits.add(c.handle, { kind: 'vehicle', id });
    this.vehicles.onRemoved = (c) => c && this.hits.remove(c.handle);

    this.nav = new Navmesh(town);
    const centre: [number, number, number] = hasSpawn
      ? town.spawn
      : [(bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2];
    this.pedestrians = new PedestrianSystem(
      hasSpawn ? PEDESTRIANS_SPAWN_ZONE : PEDESTRIANS_PER_ZONE,
      centre,
      this.physics.world,
      this.nav,
      this.state,
      this.hits,
      bounds,
      `n.${this.zone}`,
    );
    this.traffic = new TrafficSystem(
      this.physics.world,
      town,
      vehicleCatalog,
      this.state,
      this.hits,
      (route) => {
        const n = route.points.length;
        const cx = route.points.reduce((a, p) => a + p[0], 0) / n;
        const cz = route.points.reduce((a, p) => a + p[2], 0) / n;
        return mine(cx, cz);
      },
      `t.${this.zone}`,
    );
    this.interest = new InterestManager(this.state, town);

    const weaponCatalog = loadWeapons();
    new PropSystem(this.physics.world, town, weaponCatalog, this.state, this.hits, bounds);
    this.weapons = new WeaponSystem(
      this.physics.world,
      weaponCatalog.weapons,
      this.state,
      this.hits,
      {
        colliderOf: (sid) => this.physics.motor.collider(sid),
        broadcast: (e) => {
          this.broadcast(ServerMsg.Shot, e);
          // Every shot is heard: pedestrians flee, traffic hurries away.
          this.pedestrians.gunshot(e.from);
          this.traffic.gunshot(e.from, this.weapons.now);
        },
        killed: (sid, p) => {
          if (p.vehicle) this.vehicles.eject(sid, p);
        },
      },
    );

    this.border = new ZoneBorder(this.zone, bounds, {
      presence: this.presence,
      client: (sid) => this.clients.getById(sid),
      pack: (sid, p) => this.pack(sid, p),
      restore: (sid, p, payload) => this.restore(sid, p, payload),
    });

    this.patchRate = SERVER_TICK_MS;
    this.setFixedTimestep(
      (ctx) => this.tick(ctx.tick * ctx.dt, ctx.dt, ctx.subDt, ctx.subSteps),
      SERVER_TICK_HZ,
      {
        subSteps: PHYSICS_SUBSTEPS,
      },
    );
    this.clock.setInterval(
      () =>
        this.broadcast(
          ServerMsg.Stats,
          this.stats.take(this.physics, this.state.players.size, this.zone),
        ),
      1000,
    );
  }

  private tick(now: number, dt: number, subDt: number, subSteps: number): void {
    const t0 = performance.now();
    this.weapons.now = now;
    // Exactly one input per player per step: flooding inputs can't speed anyone up.
    // The fixed dt is used, never the client's claimed dt.
    for (const [sid, p] of this.state.players) {
      const input = this.inputs.get(sid).next();
      const valid: InputFrame = input && isValidInput(input) ? input : IDLE;
      if (this.border.busy(sid)) {
        if (valid !== IDLE) p.lastSeq = valid.seq; // frozen mid hand-off
        continue;
      }
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
    this.pedestrians.update(dt, now);
    this.traffic.update(dt, now);
    this.physics.step(subDt, subSteps, (d) => this.vehicles.update(d));
    this.vehicles.writeState();
    for (const sid of this.weapons.respawns(now)) {
      const p = this.state.players.get(sid);
      if (p) {
        p.space = TOWN_SPACE;
        // The spawn may be in another zone: the border check then hands the player over.
        this.physics.motor.teleport(sid, p, ...this.town.spawn, this.town.spawnYaw);
      }
    }
    this.state.tick = Math.round(now / dt);
    if (this.state.tick % INTEREST_EVERY_TICKS === 0) this.interest.update(this.clients);
    if (this.state.tick % BORDER_EVERY_TICKS === 0) this.border.check(this.state.players.entries());
    this.stats.record(performance.now() - t0);
  }

  override async onJoin(client: Client, options: { name?: string; handoff?: string } = {}) {
    const sid = client.sessionId;
    const handoff = await claim(this.presence, options.handoff);
    const p = new PlayerState();
    p.name = (handoff?.name ?? options.name ?? 'Guest').slice(0, 24);
    if (handoff) {
      Object.assign(p, {
        x: handoff.x,
        y: handoff.y,
        z: handoff.z,
        yaw: handoff.yaw,
        health: handoff.health,
      });
    } else {
      this.placeNewcomer(p);
    }
    this.state.players.set(sid, p);
    this.interest.join(client);
    this.physics.motor.add(sid, p);
    this.weapons.join(sid, p, handoff?.arsenal);
    const capsule = this.physics.motor.collider(sid);
    if (capsule) {
      this.hits.add(capsule.handle, {
        kind: 'player',
        id: sid,
        damage: (amount) => this.weapons.damagePlayer(sid, amount, this.weapons.now),
      });
    }
    if (handoff?.vehicle) this.vehicles.import(handoff.vehicle, sid, p);
  }

  /** New arrivals: the town spawn in its zone; elsewhere a sidewalk spot near the zone's centre. */
  private placeNewcomer(p: PlayerState): void {
    const spawn = this.town.spawn;
    const b = zoneBounds(this.zone);
    let at: [number, number, number] = spawn;
    if (!inZone(b, spawn[0], spawn[2]))
      at = this.nav.randomPoint([(b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2], 40);
    // Spread simultaneous joiners either side (0, +1.2, -1.2, +2.4 …) so they don't start inside
    // each other and the first few are still within the first door's range.
    const n = this.state.players.size;
    const side = n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2);
    Object.assign(p, { x: at[0] + side * 1.2, y: at[1], z: at[2], yaw: this.town.spawnYaw });
  }

  private pack(sid: string, p: PlayerState): HandoffPayload {
    const vehicle = p.vehicle ? this.vehicles.export(p.vehicle) : undefined;
    if (p.vehicle) p.vehicle = '';
    return {
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      health: p.health,
      arsenal: this.weapons.export(sid),
      vehicle,
    };
  }

  private restore(sid: string, p: PlayerState, payload: HandoffPayload): void {
    p.space = TOWN_SPACE;
    if (payload.vehicle) this.vehicles.import(payload.vehicle, sid, p);
    else this.physics.motor.setActive(sid, true);
  }

  override onLeave(client: Client) {
    const sid = client.sessionId;
    const capsule = this.physics.motor.collider(sid);
    if (capsule) this.hits.remove(capsule.handle);
    this.border.forget(sid);
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
/** Interest is refreshed at 10 Hz: fast enough for new rifle rounds, cheap for 32 clients. */
const INTEREST_EVERY_TICKS = 2;
const BORDER_EVERY_TICKS = 5;
const PEDESTRIANS_SPAWN_ZONE = 20;
const PEDESTRIANS_PER_ZONE = 8;

const IDLE: InputFrame = { seq: 0, dt: 0, keys: 0, yaw: 0, pitch: 0 };

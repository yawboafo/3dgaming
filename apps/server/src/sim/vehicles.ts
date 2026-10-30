import RAPIER from '@dimforge/rapier3d-compat';
import {
  EntityIdAllocator,
  TOWN_SPACE,
  VehicleBody,
  VehicleState,
  addInteractable,
  driveCommand,
  removeInteractables,
  updateInteractable,
  type CharacterMotor,
  type InteractionWorld,
  type PlayerState,
  type TownState,
  type VehicleCatalog,
  type Pose,
  type Vec3,
  type WorldDef,
} from '@town/shared';

/** A driven vehicle crossing into another zone. */
export interface VehicleTransfer {
  kind: string;
  pose: Pose;
  linvel: [number, number, number];
  angvel: [number, number, number];
  steer: number;
}

interface Entry {
  body: VehicleBody;
  state: VehicleState;
  /** Interactable entity for "Drive …" prompts. */
  eid: number;
  keys: number;
}

/**
 * Server-owned vehicles. Drivers' keys are relayed in; everything else (physics, who may enter,
 * where you can get out) is decided here.
 */
export class VehicleSystem {
  private readonly vehicles = new Map<string, Entry>();
  private readonly ids: EntityIdAllocator;

  constructor(
    private readonly world: RAPIER.World,
    private readonly catalog: VehicleCatalog,
    spawns: WorldDef['vehicles'],
    private readonly state: TownState,
    private readonly ecs: InteractionWorld,
    private readonly motor: CharacterMotor,
    zone = '',
  ) {
    this.ids = new EntityIdAllocator(zone);
    for (const spawn of spawns) this.add(spawn.kind, spawn.pos, spawn.rotY);
    this.writeState();
  }

  /** Spawn a parked vehicle; returns its id. */
  add(
    kind: string,
    pos: Vec3,
    rotY: number,
    rotation?: { x: number; y: number; z: number; w: number },
  ): string {
    const spec = this.catalog.kinds[kind];
    if (!spec) throw new Error(`Unknown vehicle kind "${kind}"`);
    const id = this.ids.allocate('vehicle');
    const body = new VehicleBody(RAPIER, this.world, spec, pos, rotY, rotation);
    const vs = new VehicleState();
    vs.kind = kind;
    this.state.vehicles.set(id, vs);
    const eid = addInteractable(
      this.ecs,
      {
        id,
        pos,
        range: spec.interactRange,
        prompt: `${spec.label === 'Motorbike' ? 'Ride' : 'Drive'} ${spec.label}`,
        action: { type: 'vehicle', vehicle: id },
      },
      TOWN_SPACE,
    );
    this.vehicles.set(id, { body, state: vs, eid, keys: 0 });
    this.onAdded?.(id, body.chassis.collider(0));
    return id;
  }

  /** Relay this step's keys from the driver. */
  setKeys(vehicleId: string, keys: number): void {
    const v = this.vehicles.get(vehicleId);
    if (v) v.keys = keys;
  }

  /** Before the physics sub-steps: turn keys into controller inputs. */
  drive(dt: number): void {
    for (const v of this.vehicles.values()) {
      const parked = !v.state.driver;
      v.body.drive(driveCommand(parked ? 0 : v.keys, v.body.speed, v.body.spec, parked), dt);
    }
  }

  /** Inside each physics sub-step, before world.step(). */
  update(subDt: number): void {
    for (const v of this.vehicles.values()) v.body.update(subDt);
  }

  /** After the physics sub-steps: publish poses, move drivers onto their seats. */
  writeState(): void {
    for (const [, v] of this.vehicles) {
      Object.assign(v.state, v.body.pose());
      v.state.steer = v.body.steer;
      v.state.speed = v.body.speed;
      const p = v.state;
      updateInteractable(this.ecs, v.eid, p.x, p.y, p.z, !p.driver);
      const driver = p.driver ? this.state.players.get(p.driver) : undefined;
      if (driver) {
        const [sx, sy, sz] = v.body.toWorld(v.body.spec.seat);
        // Player yaw convention: π faces +Z (see yawFacing), vehicles use 0 = +Z.
        Object.assign(driver, { x: sx, y: sy, z: sz, yaw: v.body.yaw + Math.PI, vy: 0 });
      }
    }
  }

  enter(sid: string, p: PlayerState, vehicleId: string): boolean {
    const v = this.vehicles.get(vehicleId);
    if (!v || v.state.driver || p.vehicle) return false;
    v.state.driver = sid;
    v.keys = 0;
    p.vehicle = vehicleId;
    this.motor.setActive(sid, false); // the rider's capsule mustn't collide with their own vehicle
    return true;
  }

  /** Get out at the first clear exit point. Returns false (and stays in) if boxed in. */
  exit(sid: string, p: PlayerState): boolean {
    const v = this.vehicles.get(p.vehicle);
    if (!v) return false;
    const spot = v.body.findExit();
    if (!spot) return false;
    v.state.driver = '';
    p.vehicle = '';
    this.motor.setActive(sid, true);
    this.motor.teleport(sid, p, spot[0], spot[1], spot[2], v.body.yaw + Math.PI);
    return true;
  }

  /** Everything needed to recreate a driven vehicle in another zone's room; removes it here. */
  export(vehicleId: string): VehicleTransfer | undefined {
    const v = this.vehicles.get(vehicleId);
    if (!v) return undefined;
    const lin = v.body.chassis.linvel();
    const ang = v.body.chassis.angvel();
    const out: VehicleTransfer = {
      kind: v.state.kind,
      pose: v.body.pose(),
      linvel: [lin.x, lin.y, lin.z],
      angvel: [ang.x, ang.y, ang.z],
      steer: v.body.steer,
    };
    this.onRemoved?.(v.body.chassis.collider(0));
    v.body.dispose();
    removeInteractables(this.ecs, [v.eid]);
    this.vehicles.delete(vehicleId);
    this.state.vehicles.delete(vehicleId);
    return out;
  }

  /** Recreate a vehicle handed over from a neighbouring zone, with the player already seated. */
  import(t: VehicleTransfer, sid: string, p: PlayerState): string | undefined {
    const spec = this.catalog.kinds[t.kind];
    if (!spec) return undefined;
    const id = this.add(t.kind, [t.pose.x, t.pose.y, t.pose.z], 0, {
      x: t.pose.qx,
      y: t.pose.qy,
      z: t.pose.qz,
      w: t.pose.qw,
    });
    const v = this.vehicles.get(id)!;
    v.body.chassis.setLinvel({ x: t.linvel[0], y: t.linvel[1], z: t.linvel[2] }, true);
    v.body.chassis.setAngvel({ x: t.angvel[0], y: t.angvel[1], z: t.angvel[2] }, true);
    v.body.steer = t.steer;
    this.enter(sid, p, id);
    this.writeState();
    return id;
  }

  /** Called with chassis colliders as vehicles appear/disappear (the room keeps the hit registry). */
  onAdded?: (id: string, c: RAPIER.Collider | null) => void;
  onRemoved?: (c: RAPIER.Collider | null) => void;

  /** Chassis colliders by vehicle id, so shots can tell a car from a wall. */
  *colliders(): Generator<[string, RAPIER.Collider]> {
    for (const [id, v] of this.vehicles) {
      const c = v.body.chassis.collider(0);
      if (c) yield [id, c];
    }
  }

  /** Forced out (killed while riding): normal exit if possible, otherwise on the roof. */
  eject(sid: string, p: PlayerState): void {
    if (this.exit(sid, p)) return;
    const v = this.vehicles.get(p.vehicle);
    if (!v) return;
    const t = v.body.chassis.translation();
    v.state.driver = '';
    p.vehicle = '';
    this.motor.setActive(sid, true);
    this.motor.teleport(sid, p, t.x, t.y + 2.5, t.z, p.yaw);
  }

  /** A driver disconnected: free the vehicle. */
  release(sid: string): void {
    for (const v of this.vehicles.values()) if (v.state.driver === sid) v.state.driver = '';
  }
}

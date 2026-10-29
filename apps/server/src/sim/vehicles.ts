import RAPIER from '@dimforge/rapier3d-compat';
import {
  EntityIdAllocator,
  TOWN_SPACE,
  VehicleBody,
  VehicleState,
  addInteractable,
  driveCommand,
  updateInteractable,
  type CharacterMotor,
  type InteractionWorld,
  type PlayerState,
  type TownState,
  type VehicleCatalog,
  type WorldDef,
} from '@town/shared';

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
  private readonly ids = new EntityIdAllocator();

  constructor(
    world: RAPIER.World,
    catalog: VehicleCatalog,
    town: WorldDef,
    private readonly state: TownState,
    private readonly ecs: InteractionWorld,
    private readonly motor: CharacterMotor,
  ) {
    for (const spawn of town.vehicles) {
      const spec = catalog.kinds[spawn.kind];
      if (!spec) throw new Error(`Unknown vehicle kind "${spawn.kind}"`);
      const id = this.ids.allocate('vehicle');
      const body = new VehicleBody(RAPIER, world, spec, spawn.pos, spawn.rotY);
      const vs = new VehicleState();
      vs.kind = spawn.kind;
      state.vehicles.set(id, vs);
      const eid = addInteractable(
        ecs,
        {
          id,
          pos: spawn.pos,
          range: spec.interactRange,
          prompt: `${spec.label === 'Motorbike' ? 'Ride' : 'Drive'} ${spec.label}`,
          action: { type: 'vehicle', vehicle: id },
        },
        TOWN_SPACE,
      );
      this.vehicles.set(id, { body, state: vs, eid, keys: 0 });
    }
    this.writeState();
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

  /** A driver disconnected: free the vehicle. */
  release(sid: string): void {
    for (const v of this.vehicles.values()) if (v.state.driver === sid) v.state.driver = '';
  }
}

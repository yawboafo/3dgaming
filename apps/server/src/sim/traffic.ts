import RAPIER from '@dimforge/rapier3d-compat';
import { EntityManager, FollowPathBehavior, Path, Vector3, Vehicle } from 'yuka';
import {
  VehicleState,
  clamp,
  type TownState,
  type VehicleCatalog,
  type WorldDef,
} from '@town/shared';
import type { HitRegistry } from './hits.js';

const CRUISE = 9;
const PANIC = 14;
const PANIC_RADIUS = 40;
const PANIC_S = 6;
/** Start slowing for something this far ahead; stop before this gap. */
const LOOK_AHEAD = 12;
const STOP_GAP = 4.5;
const KINDS = ['taxi', 'sedan'];
const CARS_PER_ROUTE = 2;

interface Car {
  agent: Vehicle;
  follow: FollowPathBehavior;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: VehicleState;
  /** Chassis-space front bumper distance and ray height. */
  front: number;
  rayY: number;
  panicUntil: number;
  yaw: number;
}

/**
 * Server-driven traffic: Yuka vehicles following the spline loops from town.json, carried by
 * kinematic chassis so shots and players collide with them. They brake for anything in the lane
 * ahead (players, pedestrians, other vehicles) and hurry away from gunfire.
 */
export class TrafficSystem {
  private readonly entities = new EntityManager();
  private readonly cars: Car[] = [];

  constructor(
    private readonly world: RAPIER.World,
    town: WorldDef,
    catalog: VehicleCatalog,
    state: TownState,
    hits: HitRegistry,
    /** Which loops this room drives (a zone room takes those centred in its zone). */
    owns: (route: WorldDef['trafficRoutes'][number]) => boolean = () => true,
    prefix = 't',
  ) {
    let n = 0;
    for (const route of town.trafficRoutes) {
      if (!owns(route)) continue;
      for (let k = 0; k < CARS_PER_ROUTE; k++) {
        const kind = KINDS[n % KINDS.length]!;
        const spec = catalog.kinds[kind]!;
        // Each car gets its own copy of the loop, rotated so it starts at its own waypoint.
        const start = Math.floor((route.points.length * k) / CARS_PER_ROUTE);
        const pts = [...route.points.slice(start), ...route.points.slice(0, start)];
        const path = new Path();
        path.loop = route.loop;
        for (const [x, , z] of pts) path.add(new Vector3(x, 0, z));
        const agent = new Vehicle();
        agent.maxSpeed = CRUISE;
        agent.maxForce = 30;
        agent.position.set(pts[0]![0], 0, pts[0]![2]);
        const follow = new FollowPathBehavior(path, 3.5);
        agent.steering.add(follow);
        this.entities.add(agent);

        const [hx, hy, hz] = spec.chassis.half;
        const [cx, cy, cz] = spec.chassis.center;
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pts[0]![0], 0, pts[0]![2]),
        );
        const collider = world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz),
          body,
        );
        const id = `${prefix}.${n++}`;
        const vs = new VehicleState();
        vs.kind = kind;
        vs.driver = 'npc'; // never enterable
        state.vehicles.set(id, vs);
        hits.add(collider.handle, { kind: 'vehicle', id });
        const next = pts[1] ?? pts[0]!;
        const yaw = Math.atan2(next[0] - pts[0]![0], next[2] - pts[0]![2]);
        this.cars.push({
          agent,
          follow,
          body,
          collider,
          state: vs,
          front: hz + cz,
          rayY: cy,
          panicUntil: 0,
          yaw,
        });
      }
    }
  }

  gunshot(origin: [number, number, number], now: number): void {
    for (const c of this.cars) {
      const d = Math.hypot(c.agent.position.x - origin[0], c.agent.position.z - origin[2]);
      if (d < PANIC_RADIUS) c.panicUntil = now + PANIC_S;
    }
  }

  /** Before the physics step. */
  update(dt: number, now: number): void {
    for (const c of this.cars) {
      const want = now < c.panicUntil ? PANIC : CRUISE;
      const gap = this.clearAhead(c);
      c.agent.maxSpeed = want * clamp((gap - STOP_GAP) / (LOOK_AHEAD - STOP_GAP), 0, 1);
      if (c.agent.maxSpeed === 0) c.agent.velocity.set(0, 0, 0);
    }
    this.entities.update(dt);
    for (const c of this.cars) {
      const { x, z } = c.agent.position;
      const speed = c.agent.getSpeed();
      const prevYaw = c.yaw;
      if (speed > 0.3) c.yaw = Math.atan2(c.agent.velocity.x, c.agent.velocity.z);
      const half = c.yaw / 2;
      c.body.setNextKinematicTranslation({ x, y: 0, z });
      c.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
      let turn = c.yaw - prevYaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      Object.assign(c.state, {
        x,
        y: 0,
        z,
        qx: 0,
        qy: Math.sin(half),
        qz: 0,
        qw: Math.cos(half),
        speed,
        // Approximate front-wheel angle from the turn rate (cosmetic).
        steer: clamp((turn / Math.max(dt, 1e-3)) * 0.35, -0.5, 0.5),
      });
    }
  }

  /** Distance to the first non-static thing in the lane ahead (players, NPCs, vehicles). */
  private clearAhead(c: Car): number {
    const dir = { x: Math.sin(c.yaw), y: 0, z: Math.cos(c.yaw) };
    const p = c.agent.position;
    const origin = { x: p.x + dir.x * c.front, y: c.rayY, z: p.z + dir.z * c.front };
    let nearest = LOOK_AHEAD;
    // Three rays across the lane so pedestrians and bikes off-centre still count.
    for (const side of [-0.8, 0, 0.8]) {
      const o = { x: origin.x + dir.z * side, y: origin.y, z: origin.z - dir.x * side };
      const hit = this.world.castRay(
        new RAPIER.Ray(o, dir),
        LOOK_AHEAD,
        true,
        undefined,
        undefined,
        c.collider,
        undefined,
        (col) => col.parent() !== null, // only things on bodies: players, NPCs, vehicles
      );
      if (hit) nearest = Math.min(nearest, hit.timeOfImpact); // rays start at the bumper
    }
    return nearest;
  }

  get count(): number {
    return this.cars.length;
  }
}

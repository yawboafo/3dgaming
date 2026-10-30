import RAPIER from '@dimforge/rapier3d-compat';
import {
  EntityManager,
  FollowPathBehavior,
  Path,
  State,
  StateMachine,
  Vector3,
  Vehicle,
} from 'yuka';
import { NpcMood, NpcState, PLAYER, inZone, type TownState, type ZoneBounds } from '@town/shared';
import type { HitRegistry } from './hits.js';
import type { Navmesh } from './navmesh.js';

const WALK_SPEED = 1.3;
const FLEE_SPEED = 4.6;
const HEAR_RADIUS = 30;
const FLEE_S = 8;
const DOWN_S = 15;
const CAPSULE_CENTER = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
const MODELS = ['character-male', 'character-female'];
/**
 * Path searches allowed per tick across all pedestrians (~1 ms each on the town navmesh). Requests
 * queue; a pedestrian waiting for its route keeps its current heading for a tick or two.
 */
const PATHS_PER_TICK = 2;

/** One pedestrian: a Yuka vehicle following navmesh paths, driven by a small state machine. */
class Pedestrian extends Vehicle {
  readonly brain: StateMachine<Pedestrian>;
  readonly follow = new FollowPathBehavior(new Path(), 0.8);
  health = 100;
  threat: [number, number, number] = [0, 0, 0];
  until = 0;
  /** Simulation time; set by the system each tick so states can read it. */
  now = 0;
  /** Destination (or how to choose one) waiting for a path search (see PATHS_PER_TICK). */
  wanted: [number, number, number] | (() => [number, number, number]) | undefined;
  /** True from the moment a path is requested until it's been computed. */
  get routing(): boolean {
    return this.wanted !== undefined;
  }

  constructor(
    readonly id: string,
    readonly state: NpcState,
    readonly body: RAPIER.RigidBody,
    readonly nav: Navmesh,
    readonly bounds?: ZoneBounds,
  ) {
    super();
    this.maxSpeed = WALK_SPEED;
    this.maxForce = 6;
    this.steering.add(this.follow);
    this.brain = new StateMachine<Pedestrian>(this);
    this.brain.add('walk', new WalkState());
    this.brain.add('flee', new FleeState());
    this.brain.add('down', new DownState());
  }

  here(): [number, number, number] {
    return [this.position.x, 0, this.position.z];
  }

  /** A random sidewalk point near `near`, inside this pedestrian's zone when it has one. */
  pick(near: [number, number, number], range: number): [number, number, number] {
    for (let i = 0; i < 8; i++) {
      const p = this.nav.randomPoint(near, range);
      if (!this.bounds || inZone(this.bounds, p[0], p[2], -4)) return p;
    }
    return this.here();
  }

  /** Ask for a path; the system computes it (and picks the spot, if lazy) within the budget. */
  goTo(target: [number, number, number] | (() => [number, number, number])): void {
    this.wanted = target;
  }

  /** Run the queued path search now. */
  route(): boolean {
    const want = this.wanted;
    this.wanted = undefined;
    if (!want) return false;
    const target = typeof want === 'function' ? want() : want;
    const route = this.nav.path(this.here(), target);
    const path = new Path();
    for (const [x, , z] of route) path.add(new Vector3(x, 0, z));
    this.follow.path = path;
    // Yuka's FollowPathBehavior reads path.current() unguarded: never leave it on an empty path.
    this.follow.active = route.length > 0;
    if (!this.follow.active) this.velocity.set(0, 0, 0);
    return route.length > 0;
  }

  arrived(): boolean {
    return !this.routing && (!this.follow.active || this.follow.path.finished());
  }
}

class WalkState extends State<Pedestrian> {
  override enter(p: Pedestrian): void {
    p.maxSpeed = WALK_SPEED;
    p.state.mood = NpcMood.Walk;
    p.until = p.now + Math.random() * 2; // brief pause before setting off
    p.follow.active = false;
    p.wanted = undefined;
    p.velocity.set(0, 0, 0);
  }
  override execute(p: Pedestrian): void {
    if (p.arrived() && p.now >= p.until) {
      p.goTo(() => p.pick(p.here(), 60));
      p.until = p.now + 2 + Math.random() * 4;
    }
  }
}

class FleeState extends State<Pedestrian> {
  override enter(p: Pedestrian): void {
    p.maxSpeed = FLEE_SPEED;
    p.state.mood = NpcMood.Flee;
    p.until = p.now + FLEE_S;
    this.runAway(p);
  }
  override execute(p: Pedestrian): void {
    if (p.now >= p.until) p.brain.changeTo('walk');
    else if (p.arrived()) this.runAway(p);
  }
  private runAway(p: Pedestrian): void {
    const [x, , z] = p.here();
    const dx = x - p.threat[0];
    const dz = z - p.threat[2];
    const l = Math.hypot(dx, dz) || 1;
    p.goTo(() => p.pick([x + (dx / l) * 35, 0, z + (dz / l) * 35], 25));
  }
}

class DownState extends State<Pedestrian> {
  override enter(p: Pedestrian): void {
    p.state.mood = NpcMood.Down;
    p.maxSpeed = 0;
    p.velocity.set(0, 0, 0);
    p.follow.active = false;
    p.wanted = undefined;
    p.until = p.now + DOWN_S;
    p.body.collider(0)?.setEnabled(false);
  }
  override execute(p: Pedestrian): void {
    if (p.now < p.until) return;
    // Back up somewhere nearby, out of sight of the scene.
    const [x, , z] = p.pick(p.here(), 80);
    p.position.set(x, 0, z);
    p.health = 100;
    p.state.health = 100;
    p.body.collider(0)?.setEnabled(true);
    p.brain.changeTo('walk');
  }
  override exit(): void {}
}

/**
 * Server-driven pedestrians on the sidewalk navmesh. They stroll between random destinations,
 * flee from gunfire they can hear, and go down when shot (damage is applied here, never on the
 * client). Each has a kinematic capsule so shots and players collide with it.
 */
export class PedestrianSystem {
  private readonly entities = new EntityManager();
  private readonly peds: Pedestrian[] = [];
  /** Round-robin start so no pedestrian starves when many want paths at once. */
  private nextRoute = 0;

  constructor(
    count: number,
    near: [number, number, number],
    private readonly world: RAPIER.World,
    nav: Navmesh,
    state: TownState,
    hits: HitRegistry,
    bounds?: ZoneBounds,
    prefix = 'n',
  ) {
    for (let i = 0; i < count; i++) {
      const id = `${prefix}.${i}`;
      let [x, , z] = nav.randomPoint(near, 90);
      for (let k = 0; k < 8 && bounds && !inZone(bounds, x, z, -4); k++)
        [x, , z] = nav.randomPoint(near, 90);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, CAPSULE_CENTER, z),
      );
      const col = world.createCollider(
        RAPIER.ColliderDesc.capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius),
        body,
      );
      const ns = new NpcState();
      ns.kind = MODELS[i % MODELS.length]!;
      state.npcs.set(id, ns);
      const p = new Pedestrian(id, ns, body, nav, bounds);
      p.position.set(x, 0, z);
      this.entities.add(p);
      this.peds.push(p);
      p.brain.changeTo('walk');
      hits.add(col.handle, { kind: 'npc', id, damage: (amount) => this.damage(p, amount) });
    }
  }

  /** A shot was fired from `origin`: anyone close enough to hear it runs. */
  gunshot(origin: [number, number, number]): void {
    for (const p of this.peds) {
      if (p.health === 0) continue;
      const d = Math.hypot(p.position.x - origin[0], p.position.z - origin[2]);
      if (d > HEAR_RADIUS) continue;
      this.scare(p, origin);
    }
  }

  /** Start fleeing, or keep fleeing longer: already-running pedestrians don't re-plan per shot. */
  private scare(p: Pedestrian, from: [number, number, number]): void {
    p.threat = [...from];
    if (p.state.mood === NpcMood.Flee) p.until = p.now + FLEE_S;
    else p.brain.changeTo('flee');
  }

  /** Before the physics step. */
  update(dt: number, now: number): void {
    for (const p of this.peds) {
      p.now = now;
      p.brain.update();
    }
    let budget = PATHS_PER_TICK;
    for (let k = 0; k < this.peds.length && budget > 0; k++) {
      const p = this.peds[(this.nextRoute + k) % this.peds.length]!;
      if (!p.routing) continue;
      p.route();
      budget--;
      this.nextRoute = (this.nextRoute + k + 1) % this.peds.length;
    }
    this.entities.update(dt);
    for (const p of this.peds) {
      const { x, z } = p.position;
      p.body.setNextKinematicTranslation({ x, y: CAPSULE_CENTER, z });
      const speed = p.getSpeed();
      const s = p.state;
      s.x = x;
      s.y = 0;
      s.z = z;
      s.speed = speed;
      if (speed > 0.1) s.yaw = Math.atan2(p.velocity.x, p.velocity.z);
    }
  }

  private damage(p: Pedestrian, amount: number): void {
    if (p.health === 0) return;
    p.health = Math.max(0, p.health - amount);
    p.state.health = p.health;
    if (p.health === 0) p.brain.changeTo('down');
    else this.scare(p, p.here());
  }

  get count(): number {
    return this.peds.length;
  }

  dispose(): void {
    for (const p of this.peds) this.world.removeRigidBody(p.body);
  }
}

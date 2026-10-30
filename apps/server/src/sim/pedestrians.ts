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
import { NpcMood, NpcState, PLAYER, type TownState } from '@town/shared';
import type { HitRegistry } from './hits.js';
import type { Navmesh } from './navmesh.js';

const WALK_SPEED = 1.3;
const FLEE_SPEED = 4.6;
const HEAR_RADIUS = 30;
const FLEE_S = 8;
const DOWN_S = 15;
const CAPSULE_CENTER = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
const MODELS = ['character-male', 'character-female'];

/** One pedestrian: a Yuka vehicle following navmesh paths, driven by a small state machine. */
class Pedestrian extends Vehicle {
  readonly brain: StateMachine<Pedestrian>;
  readonly follow = new FollowPathBehavior(new Path(), 0.8);
  health = 100;
  threat: [number, number, number] = [0, 0, 0];
  until = 0;
  /** Simulation time; set by the system each tick so states can read it. */
  now = 0;

  constructor(
    readonly id: string,
    readonly state: NpcState,
    readonly body: RAPIER.RigidBody,
    readonly nav: Navmesh,
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

  goTo(target: [number, number, number]): boolean {
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
    return !this.follow.active || this.follow.path.finished();
  }
}

class WalkState extends State<Pedestrian> {
  override enter(p: Pedestrian): void {
    p.maxSpeed = WALK_SPEED;
    p.state.mood = NpcMood.Walk;
    p.until = p.now + Math.random() * 2; // brief pause before setting off
    p.follow.active = false;
    p.velocity.set(0, 0, 0);
  }
  override execute(p: Pedestrian): void {
    if (p.arrived() && p.now >= p.until) {
      p.goTo(p.nav.randomPoint(p.here(), 60));
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
    p.goTo(p.nav.randomPoint([x + (dx / l) * 35, 0, z + (dz / l) * 35], 15));
  }
}

class DownState extends State<Pedestrian> {
  override enter(p: Pedestrian): void {
    p.state.mood = NpcMood.Down;
    p.maxSpeed = 0;
    p.velocity.set(0, 0, 0);
    p.follow.active = false;
    p.until = p.now + DOWN_S;
    p.body.collider(0)?.setEnabled(false);
  }
  override execute(p: Pedestrian): void {
    if (p.now < p.until) return;
    // Back up somewhere nearby, out of sight of the scene.
    const [x, , z] = p.nav.randomPoint(p.here(), 80);
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

  constructor(
    count: number,
    near: [number, number, number],
    private readonly world: RAPIER.World,
    nav: Navmesh,
    state: TownState,
    hits: HitRegistry,
  ) {
    for (let i = 0; i < count; i++) {
      const id = `n.${i}`;
      const [x, , z] = nav.randomPoint(near, 90);
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
      const p = new Pedestrian(id, ns, body, nav);
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
      p.threat = [...origin];
      p.brain.changeTo('flee');
    }
  }

  /** Before the physics step. */
  update(dt: number, now: number): void {
    for (const p of this.peds) {
      p.now = now;
      p.brain.update();
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
    else {
      p.threat = p.here();
      p.brain.changeTo('flee');
    }
  }

  get count(): number {
    return this.peds.length;
  }

  dispose(): void {
    for (const p of this.peds) this.world.removeRigidBody(p.body);
  }
}

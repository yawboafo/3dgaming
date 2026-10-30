/**
 * Minimal types for the parts of Yuka (https://mugen87.github.io/yuka/) the server uses.
 * Yuka ships plain JavaScript; this avoids adding @types/yuka as another dependency.
 */
declare module 'yuka' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    length(): number;
    squaredDistanceTo(v: Vector3): number;
    distanceTo(v: Vector3): number;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
  }

  export class GameEntity {
    position: Vector3;
    rotation: Quaternion;
    name: string;
  }

  export class MovingEntity extends GameEntity {
    velocity: Vector3;
    maxSpeed: number;
    getSpeed(): number;
  }

  export class SteeringBehavior {
    active: boolean;
    weight: number;
  }

  export class Path {
    loop: boolean;
    add(waypoint: Vector3): this;
    clear(): this;
    current(): Vector3;
    finished(): boolean;
    advance(): this;
  }

  export class FollowPathBehavior extends SteeringBehavior {
    constructor(path?: Path, nextWaypointDistance?: number);
    path: Path;
    nextWaypointDistance: number;
  }

  export class OnPathBehavior extends SteeringBehavior {
    constructor(path?: Path, radius?: number, predictionFactor?: number);
    path: Path;
    radius: number;
  }

  export class SteeringManager {
    add(behavior: SteeringBehavior): this;
    remove(behavior: SteeringBehavior): this;
  }

  export class Vehicle extends MovingEntity {
    mass: number;
    maxForce: number;
    steering: SteeringManager;
  }

  export class EntityManager {
    add(entity: GameEntity): this;
    remove(entity: GameEntity): this;
    update(delta: number): this;
  }

  export class State<T> {
    enter(owner: T): void;
    execute(owner: T): void;
    exit(owner: T): void;
  }

  export class StateMachine<T> {
    constructor(owner?: T);
    currentState: State<T> | null;
    add(id: string, state: State<T>): this;
    changeTo(id: string): this;
    update(): this;
  }
}

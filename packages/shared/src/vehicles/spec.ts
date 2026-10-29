import type { InteriorBox, Vec3 } from '../world.js';

/** world/vehicles.json — every tunable for a vehicle kind lives in data, not code. */
export interface WheelSpec {
  /** Suspension hard point in chassis space (model front is +Z, left is +X). */
  pos: Vec3;
  radius: number;
  steer: boolean;
  drive: boolean;
  handbrake: boolean;
  /** Wheel node in the vehicle's glTF, or a separate wheel asset when the model has none. */
  node?: string;
  asset?: string;
  scale?: Vec3;
}

export interface VehicleSpec {
  label: string;
  model: { asset?: string; scale: number; parts?: InteriorBox[] };
  chassis: {
    half: Vec3;
    center: Vec3;
    density: number;
    /** Extra mass low in the chassis so hard braking and turning don't tip it over. */
    ballast?: { mass: number; y: number };
  };
  wheels: WheelSpec[];
  suspension: {
    rest: number;
    travel: number;
    stiffness: number;
    compression: number;
    relaxation: number;
    maxForce: number;
  };
  friction: { slip: number; side: number; handbrakeSlip: number };
  engine: {
    force: number;
    reverseForce: number;
    brake: number;
    /** Light brake with no throttle, so cars coast to a stop. */
    rolling: number;
    maxSteer: number;
    /** Speed (m/s) at which steering is halved. */
    steerFalloffSpeed: number;
    /** Radians per second the wheels turn toward the target angle. */
    steerRate: number;
    maxSpeed: number;
  };
  /** Two-wheelers: physics stays upright (roll/pitch locked); lean is cosmetic. */
  keepUpright?: boolean;
  leanMax?: number;
  /** Rider position in chassis space. */
  seat: Vec3;
  /** Candidate exit points in chassis space, tried in order. */
  exits: Vec3[];
  interactRange: number;
}

export interface VehicleCatalog {
  version: 1;
  kinds: Record<string, VehicleSpec>;
}

export interface VehicleSpawn {
  kind: string;
  pos: Vec3;
  rotY: number;
}

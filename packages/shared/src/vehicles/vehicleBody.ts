import type RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../constants.js';
import type { Vec3 } from '../world.js';
import { approach, type DriveCommand } from './drive.js';
import type { VehicleSpec } from './spec.js';

type Rapier = typeof RAPIER;

const UP = 1;
const FORWARD = 2; // models face +Z

export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/**
 * A dynamic chassis driven by Rapier's DynamicRayCastVehicleController, configured entirely from
 * a VehicleSpec. Call drive() then update() before world.step().
 */
export class VehicleBody {
  readonly chassis: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** Current (smoothed) steering angle. */
  steer = 0;

  constructor(
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
    readonly spec: VehicleSpec,
    pos: Vec3,
    rotY: number,
    /** Full orientation (zone hand-offs carry the exact pose); overrides rotY. */
    rotation?: { x: number; y: number; z: number; w: number },
  ) {
    const r = (rotY * Math.PI) / 360;
    const c = spec.chassis;
    const desc = R.RigidBodyDesc.dynamic();
    if (c.ballast) {
      // Inertia of a box the chassis' size carrying the ballast mass.
      const [w, h, d] = c.half.map((v) => v * 2) as [number, number, number];
      const m = c.ballast.mass / 12;
      desc.setAdditionalMassProperties(
        c.ballast.mass,
        { x: 0, y: c.ballast.y, z: 0 },
        { x: m * (h * h + d * d), y: m * (w * w + d * d), z: m * (w * w + h * h) },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    }
    this.chassis = world.createRigidBody(
      desc
        .setTranslation(pos[0], pos[1], pos[2])
        .setRotation(rotation ?? { x: 0, y: Math.sin(r), z: 0, w: Math.cos(r) })
        .setLinearDamping(0.05)
        .setAngularDamping(spec.keepUpright ? 2 : 0.6)
        .setCanSleep(false),
    );
    if (spec.keepUpright) this.chassis.setEnabledRotations(false, true, false, true);
    world.createCollider(
      R.ColliderDesc.cuboid(c.half[0], c.half[1], c.half[2])
        .setTranslation(c.center[0], c.center[1], c.center[2])
        .setDensity(c.density)
        .setFriction(0.4),
      this.chassis,
    );

    this.controller = world.createVehicleController(this.chassis);
    this.controller.indexUpAxis = UP;
    this.controller.setIndexForwardAxis = FORWARD;
    const s = spec.suspension;
    spec.wheels.forEach((w, i) => {
      this.controller.addWheel(
        { x: w.pos[0], y: w.pos[1], z: w.pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        s.rest,
        w.radius,
      );
      this.controller.setWheelSuspensionStiffness(i, s.stiffness);
      this.controller.setWheelSuspensionCompression(i, s.compression);
      this.controller.setWheelSuspensionRelaxation(i, s.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, s.travel);
      this.controller.setWheelMaxSuspensionForce(i, s.maxForce);
      this.controller.setWheelFrictionSlip(i, spec.friction.slip);
      this.controller.setWheelSideFrictionStiffness(i, spec.friction.side);
    });
  }

  drive(cmd: DriveCommand, dt: number): void {
    const { spec, controller } = this;
    this.steer = approach(this.steer, cmd.steer, spec.engine.steerRate * dt);
    spec.wheels.forEach((w, i) => {
      controller.setWheelSteering(i, w.steer ? this.steer : 0);
      controller.setWheelEngineForce(i, w.drive ? cmd.engine : 0);
      const hb = cmd.handbrake && w.handbrake;
      controller.setWheelBrake(i, cmd.brake + (hb ? spec.engine.brake : 0));
      controller.setWheelFrictionSlip(i, hb ? spec.friction.handbrakeSlip : spec.friction.slip);
    });
  }

  update(dt: number): void {
    this.controller.updateVehicle(dt);
  }

  /** Signed speed along the chassis' forward axis (m/s). */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  pose(): Pose {
    const t = this.chassis.translation();
    const q = this.chassis.rotation();
    return { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  }

  /** Heading around Y (rad), 0 = facing +Z. */
  get yaw(): number {
    const q = this.chassis.rotation();
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  }

  /** Chassis-space point → world. */
  toWorld(p: Vec3): Vec3 {
    const t = this.chassis.translation();
    const q = this.chassis.rotation();
    // v' = v + 2w(q×v) + 2q×(q×v)
    const cx = q.y * p[2] - q.z * p[1];
    const cy = q.z * p[0] - q.x * p[2];
    const cz = q.x * p[1] - q.y * p[0];
    return [
      t.x + p[0] + 2 * (q.w * cx + q.y * cz - q.z * cy),
      t.y + p[1] + 2 * (q.w * cy + q.z * cx - q.x * cz),
      t.z + p[2] + 2 * (q.w * cz + q.x * cy - q.y * cx),
    ];
  }

  /**
   * First exit point (chassis space, tried in spec order) where a standing player fits,
   * ignoring this vehicle. Returns feet position or undefined if boxed in.
   */
  findExit(): Vec3 | undefined {
    const shape = new this.R.Capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius);
    const centre = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
    // The chassis origin sits at road level (it can dip a little below on compressed springs).
    const feet = Math.max(0, this.chassis.translation().y);
    for (const local of this.spec.exits) {
      const [x, , z] = this.toWorld(local);
      const hit = this.world.intersectionWithShape(
        { x, y: feet + centre + 0.15, z },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        undefined,
        undefined,
        undefined,
        this.chassis,
      );
      if (!hit) return [x, feet, z];
    }
    return undefined;
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.chassis);
  }
}

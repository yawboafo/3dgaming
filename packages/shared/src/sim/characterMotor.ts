import type RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PLAYER } from '../constants.js';
import type { InputFrame } from '../messages.js';
import { movementIntent } from './intent.js';

type Rapier = typeof RAPIER;

/** The authoritative fields a character carries between steps (matches PlayerState). */
export interface CharacterBody {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vy: number;
}

const CAPSULE_CENTER = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;

/**
 * Rapier KinematicCharacterController wrapper. One per physics world; characters are kinematic
 * capsules. Positions in CharacterBody are at the feet.
 */
export class CharacterMotor {
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly capsules = new Map<string, RAPIER.Collider>();

  constructor(
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
  ) {
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  }

  add(id: string, b: CharacterBody): void {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(b.x, b.y + CAPSULE_CENTER, b.z),
    );
    const col = this.world.createCollider(
      this.R.ColliderDesc.capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius),
      body,
    );
    this.capsules.set(id, col);
  }

  remove(id: string): void {
    const col = this.capsules.get(id);
    if (!col) return;
    const body = col.parent();
    if (body) this.world.removeRigidBody(body);
    this.capsules.delete(id);
  }

  collider(id: string): RAPIER.Collider | undefined {
    return this.capsules.get(id);
  }

  /** Riders' capsules are switched off so they don't collide with their own vehicle. */
  setActive(id: string, active: boolean): void {
    this.capsules.get(id)?.setEnabled(active);
  }

  /**
   * Put the capsule where `b` says without touching its velocity: client prediction rewinds to the
   * server's state and replays inputs from there.
   */
  place(id: string, b: CharacterBody): void {
    const body = this.capsules.get(id)?.parent();
    if (!body) return;
    const at = { x: b.x, y: b.y + CAPSULE_CENTER, z: b.z };
    body.setTranslation(at, false);
    body.setNextKinematicTranslation(at);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  /** Move a character instantly (doors, respawns). Clears vertical velocity. */
  teleport(id: string, b: CharacterBody, x: number, y: number, z: number, yaw: number): void {
    const body = this.capsules.get(id)?.parent();
    if (!body) return;
    body.setTranslation({ x, y: y + CAPSULE_CENTER, z }, true);
    body.setNextKinematicTranslation({ x, y: y + CAPSULE_CENTER, z });
    // Colliders only follow their body on world.step(); sync now so queries see the new spot.
    this.world.propagateModifiedBodyPositionsToColliders();
    Object.assign(b, { x, y, z, yaw, vy: 0 });
  }

  /** Advance one character by one fixed step. Call world.step() once after moving everyone. */
  move(id: string, b: CharacterBody, input: InputFrame, dt: number): void {
    const col = this.capsules.get(id);
    if (!col) return;
    const intent = movementIntent(input);
    if (intent.yaw !== undefined) b.yaw = intent.yaw;

    b.vy += GRAVITY * dt;
    this.controller.computeColliderMovement(col, {
      x: intent.vx * dt,
      y: b.vy * dt,
      z: intent.vz * dt,
    });
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    if (grounded) b.vy = intent.jump ? PLAYER.jumpSpeed : 0;
    else if (b.vy > 0 && m.y < b.vy * dt - 1e-4) b.vy = 0; // bumped a ceiling

    // Read the body, not the collider: a collider's pose only syncs on world.step(), so after a
    // teleport between steps it would still report the old spot and undo the teleport.
    const body = col.parent();
    const t = body ? body.translation() : col.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    body?.setNextKinematicTranslation(next);
    b.x = next.x;
    b.y = next.y - CAPSULE_CENTER;
    b.z = next.z;
  }
}

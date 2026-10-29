import { GRAVITY, PLAYER } from '../constants.js';
import { WORLD_SIZE } from '../chunks.js';
import { Key, hasKey, type InputFrame } from '../messages.js';
import { clamp } from '../timestep.js';

export interface Body {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vy: number;
}

/**
 * Placeholder on-foot integration (flat ground, no obstacles). Step 2 replaces this with
 * Rapier's KinematicCharacterController; the shape of the function stays the same so the
 * client can run it for prediction.
 */
export function movePlayer(b: Body, input: InputFrame, dt: number): void {
  let fx = 0;
  let fz = 0;
  if (hasKey(input.keys, Key.Forward)) fz -= 1;
  if (hasKey(input.keys, Key.Back)) fz += 1;
  if (hasKey(input.keys, Key.Left)) fx -= 1;
  if (hasKey(input.keys, Key.Right)) fx += 1;

  const len = Math.hypot(fx, fz);
  if (len > 0) {
    const speed = hasKey(input.keys, Key.Sprint) ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    fx /= len;
    fz /= len;
    // Rotate camera-relative intent by yaw.
    const s = Math.sin(input.yaw);
    const c = Math.cos(input.yaw);
    b.x += (fx * c + fz * s) * speed * dt;
    b.z += (-fx * s + fz * c) * speed * dt;
    b.yaw = Math.atan2(fx * c + fz * s, -fx * s + fz * c) + Math.PI;
  }

  const grounded = b.y <= 0;
  if (grounded && hasKey(input.keys, Key.Jump)) b.vy = PLAYER.jumpSpeed;
  b.vy += GRAVITY * dt;
  b.y += b.vy * dt;
  if (b.y < 0) {
    b.y = 0;
    b.vy = 0;
  }
  b.x = clamp(b.x, 0, WORLD_SIZE);
  b.z = clamp(b.z, 0, WORLD_SIZE);
}

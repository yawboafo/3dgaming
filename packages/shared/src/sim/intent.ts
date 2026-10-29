import { PLAYER } from '../constants.js';
import { Key, hasKey, type InputFrame } from '../messages.js';

export interface MoveIntent {
  /** Horizontal velocity in m/s (world space). */
  vx: number;
  vz: number;
  /** Facing yaw when moving; undefined when standing still (keep the previous facing). */
  yaw: number | undefined;
  jump: boolean;
}

/** Camera-relative WASD → world-space velocity. Pure, so client prediction can share it. */
export function movementIntent(input: InputFrame): MoveIntent {
  let fx = 0;
  let fz = 0;
  if (hasKey(input.keys, Key.Forward)) fz -= 1;
  if (hasKey(input.keys, Key.Back)) fz += 1;
  if (hasKey(input.keys, Key.Left)) fx -= 1;
  if (hasKey(input.keys, Key.Right)) fx += 1;
  const jump = hasKey(input.keys, Key.Jump);
  const len = Math.hypot(fx, fz);
  if (len === 0) return { vx: 0, vz: 0, yaw: undefined, jump };

  const speed = hasKey(input.keys, Key.Sprint) ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const s = Math.sin(input.yaw);
  const c = Math.cos(input.yaw);
  const wx = (fx / len) * c + (fz / len) * s;
  const wz = -(fx / len) * s + (fz / len) * c;
  return { vx: wx * speed, vz: wz * speed, yaw: Math.atan2(wx, wz) + Math.PI, jump };
}

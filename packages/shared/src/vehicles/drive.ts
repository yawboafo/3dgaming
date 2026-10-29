import { Key, hasKey } from '../messages.js';
import type { VehicleSpec } from './spec.js';

export interface DriveCommand {
  /** Force on each driven wheel (N); negative reverses. */
  engine: number;
  /** Brake on every wheel. */
  brake: number;
  /** Extra brake on handbrake wheels, which also lose grip so the rear can slide. */
  handbrake: boolean;
  /** Target steering angle (rad), positive = left. */
  steer: number;
}

const STOP_SPEED = 1;

/**
 * Keys + current forward speed → controller command. Pure, so it's shared by the server
 * simulation, client prediction and tests. With no driver, pass keys = 0 and parked = true.
 */
export function driveCommand(
  keys: number,
  speed: number,
  spec: VehicleSpec,
  parked = false,
): DriveCommand {
  const e = spec.engine;
  if (parked) return { engine: 0, brake: e.brake, handbrake: true, steer: 0 };

  const fwd = hasKey(keys, Key.Forward);
  const back = hasKey(keys, Key.Back);
  let engine = 0;
  let brake = 0;
  if (fwd && speed < -STOP_SPEED)
    brake = e.brake; // rolling backwards: brake first
  else if (fwd && speed < e.maxSpeed) engine = e.force;
  if (back && speed > STOP_SPEED)
    brake = e.brake; // moving forward: S brakes…
  else if (back && speed > -e.maxSpeed / 3) engine = -e.reverseForce; // …then reverses
  if (!fwd && !back) brake = e.rolling;

  const dir = (hasKey(keys, Key.Left) ? 1 : 0) - (hasKey(keys, Key.Right) ? 1 : 0);
  const falloff = 1 / (1 + Math.abs(speed) / e.steerFalloffSpeed);
  return {
    engine,
    brake,
    handbrake: hasKey(keys, Key.Jump) || hasKey(keys, Key.Handbrake),
    steer: dir * e.maxSteer * falloff,
  };
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

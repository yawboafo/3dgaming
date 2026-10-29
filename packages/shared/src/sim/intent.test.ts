import { describe, expect, it } from 'vitest';
import { PLAYER } from '../constants.js';
import { Key } from '../messages.js';
import { movementIntent } from './intent.js';

const frame = (keys: number, yaw = 0) => ({ seq: 1, dt: 0.05, keys, yaw, pitch: 0 });

describe('movementIntent', () => {
  it('walks forward (-Z) at walk speed for yaw 0', () => {
    const i = movementIntent(frame(Key.Forward));
    expect(i.vz).toBeCloseTo(-PLAYER.walkSpeed);
    expect(i.vx).toBeCloseTo(0);
  });

  it('is camera-relative', () => {
    const i = movementIntent(frame(Key.Forward, Math.PI / 2));
    expect(i.vx).toBeCloseTo(-PLAYER.walkSpeed);
    expect(i.vz).toBeCloseTo(0);
  });

  it('does not exceed sprint speed on diagonals', () => {
    const i = movementIntent(frame(Key.Forward | Key.Right | Key.Sprint));
    expect(Math.hypot(i.vx, i.vz)).toBeCloseTo(PLAYER.sprintSpeed);
  });

  it('keeps facing when idle', () => {
    expect(movementIntent(frame(0)).yaw).toBeUndefined();
  });
});

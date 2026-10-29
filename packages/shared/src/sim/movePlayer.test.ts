import { describe, expect, it } from 'vitest';
import { PLAYER } from '../constants.js';
import { Key } from '../messages.js';
import { movePlayer, type Body } from './movePlayer.js';

const body = (): Body => ({ x: 100, y: 0, z: 100, yaw: 0, vy: 0 });

describe('movePlayer', () => {
  it('walks forward (-Z) at walk speed for yaw 0', () => {
    const b = body();
    movePlayer(b, { seq: 1, dt: 1, keys: Key.Forward, yaw: 0, pitch: 0 }, 1);
    expect(b.z).toBeCloseTo(100 - PLAYER.walkSpeed);
    expect(b.x).toBeCloseTo(100);
  });

  it('does not exceed sprint speed on diagonals', () => {
    const b = body();
    const keys = Key.Forward | Key.Right | Key.Sprint;
    movePlayer(b, { seq: 1, dt: 1, keys, yaw: 0, pitch: 0 }, 1);
    expect(Math.hypot(b.x - 100, b.z - 100)).toBeCloseTo(PLAYER.sprintSpeed);
  });

  it('jumps only when grounded and lands back on the floor', () => {
    const b = body();
    movePlayer(b, { seq: 1, dt: 0.05, keys: Key.Jump, yaw: 0, pitch: 0 }, 0.05);
    expect(b.y).toBeGreaterThan(0);
    const vy = b.vy;
    movePlayer(b, { seq: 2, dt: 0.05, keys: Key.Jump, yaw: 0, pitch: 0 }, 0.05);
    expect(b.vy).toBeLessThan(vy);
    for (let i = 0; i < 100; i++)
      movePlayer(b, { seq: 3 + i, dt: 0.05, keys: 0, yaw: 0, pitch: 0 }, 0.05);
    expect(b.y).toBe(0);
  });
});

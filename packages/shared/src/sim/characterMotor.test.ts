import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAVITY, PLAYER } from '../constants.js';
import { Key } from '../messages.js';
import { CharacterMotor, type CharacterBody } from './characterMotor.js';
import { addProxy, addWorldBounds } from './colliders.js';

const DT = 0.05;
const frame = (keys: number, yaw = 0) => ({ seq: 1, dt: DT, keys, yaw, pitch: 0 });

function setup(extra: (w: RAPIER.World) => void = () => {}) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addWorldBounds(RAPIER, world);
  extra(world);
  world.step(); // populate the broad phase before the first query
  const motor = new CharacterMotor(RAPIER, world);
  const body: CharacterBody = { x: 100, y: 0, z: 100, yaw: 0, vy: 0 };
  motor.add('p', body);
  world.step();
  const run = (keys: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      motor.move('p', body, frame(keys), DT);
      world.timestep = DT;
      world.step();
    }
  };
  return { body, run };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('CharacterMotor', () => {
  it('walks at walk speed on flat ground and stays grounded', () => {
    const { body, run } = setup();
    run(Key.Forward, 20);
    expect(100 - body.z).toBeCloseTo(PLAYER.walkSpeed * 20 * DT, 0);
    expect(body.y).toBeCloseTo(0, 1);
  });

  it('is stopped by a wall', () => {
    const { body, run } = setup((w) =>
      addProxy(RAPIER, w, { type: 'box', pos: [100, 2, 96], half: [5, 2, 0.5] }),
    );
    run(Key.Forward, 60);
    expect(body.z).toBeGreaterThan(96.5);
    expect(body.z).toBeLessThan(97.5);
  });

  it('jumps and lands', () => {
    const { body, run } = setup();
    run(Key.Jump, 1);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      run(0, 1);
      peak = Math.max(peak, body.y);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(body.y).toBeCloseTo(0, 1);
    expect(body.vy).toBe(0);
  });

  it('slides along a wall when walking into it at an angle', () => {
    const { body, run } = setup((w) =>
      addProxy(RAPIER, w, { type: 'box', pos: [100, 2, 96], half: [20, 2, 0.5] }),
    );
    run(Key.Forward | Key.Left, 60);
    expect(body.z).toBeGreaterThan(96.5);
    expect(body.x).toBeLessThan(95);
  });
});

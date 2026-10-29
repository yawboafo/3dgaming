import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Key } from '../messages.js';
import { approach, driveCommand } from './drive.js';
import type { VehicleCatalog } from './spec.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../../../world/vehicles.json', import.meta.url), 'utf8'),
) as VehicleCatalog;
const car = catalog.kinds.sedan!;

describe('driveCommand', () => {
  it('throttles forward and coasts with no input', () => {
    expect(driveCommand(Key.Forward, 0, car).engine).toBe(car.engine.force);
    const coast = driveCommand(0, 10, car);
    expect(coast.engine).toBe(0);
    expect(coast.brake).toBe(car.engine.rolling);
  });

  it('brakes with S while moving forward, then reverses once stopped', () => {
    const braking = driveCommand(Key.Back, 8, car);
    expect(braking.brake).toBe(car.engine.brake);
    expect(braking.engine).toBe(0);
    expect(driveCommand(Key.Back, 0, car).engine).toBe(-car.engine.reverseForce);
  });

  it('brakes with W while rolling backwards', () => {
    const c = driveCommand(Key.Forward, -5, car);
    expect(c.brake).toBe(car.engine.brake);
    expect(c.engine).toBe(0);
  });

  it('cuts the engine at top speed', () => {
    expect(driveCommand(Key.Forward, car.engine.maxSpeed + 1, car).engine).toBe(0);
  });

  it('steers left positive and less at speed', () => {
    expect(driveCommand(Key.Left, 0, car).steer).toBeCloseTo(car.engine.maxSteer);
    expect(driveCommand(Key.Right, 0, car).steer).toBeCloseTo(-car.engine.maxSteer);
    const fast = driveCommand(Key.Left, car.engine.steerFalloffSpeed, car).steer;
    expect(fast).toBeCloseTo(car.engine.maxSteer / 2);
  });

  it('maps Space to the handbrake and parks with brakes on', () => {
    expect(driveCommand(Key.Jump, 5, car).handbrake).toBe(true);
    const parked = driveCommand(Key.Forward, 0, car, true);
    expect(parked.engine).toBe(0);
    expect(parked.brake).toBe(car.engine.brake);
  });

  it('approaches a target without overshooting', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(0, -1, 0.3)).toBeCloseTo(-0.3);
  });
});

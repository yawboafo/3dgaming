import { describe, expect, it } from 'vitest';
import { FixedTimestep, lerpAngle } from './timestep.js';
import { EntityIdAllocator, kindOf } from './ids.js';
import { isValidInput } from './messages.js';

describe('FixedTimestep', () => {
  it('runs whole steps and carries the remainder', () => {
    const ts = new FixedTimestep(1 / 60);
    expect(ts.advance(1 / 120).steps).toBe(0);
    const r = ts.advance(1 / 120 + 1 / 60);
    expect(r.steps).toBe(2);
    expect(r.alpha).toBeCloseTo(0, 5);
  });

  it('caps steps after a stall', () => {
    const ts = new FixedTimestep(1 / 60, 5);
    expect(ts.advance(2).steps).toBe(5);
  });
});

describe('lerpAngle', () => {
  it('takes the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 5);
  });
});

describe('ids', () => {
  it('encodes kind in the prefix', () => {
    const ids = new EntityIdAllocator('zone_0_0');
    const a = ids.allocate('vehicle');
    expect(kindOf(a)).toBe('vehicle');
    expect(ids.allocate('vehicle')).not.toBe(a);
  });
});

describe('input validation', () => {
  it('rejects malformed or oversized frames', () => {
    expect(isValidInput({ seq: 1, dt: 1 / 60, keys: 3, yaw: 0, pitch: 0 })).toBe(true);
    expect(isValidInput({ seq: 1, dt: 5, keys: 3, yaw: 0, pitch: 0 })).toBe(false);
    expect(isValidInput({ seq: 1.5, dt: 0.01, keys: 0, yaw: 0, pitch: 0 })).toBe(false);
    expect(isValidInput(null)).toBe(false);
  });
});

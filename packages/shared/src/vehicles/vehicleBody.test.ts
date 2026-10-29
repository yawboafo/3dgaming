import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAVITY } from '../constants.js';
import { Key } from '../messages.js';
import { addProxy, addWorldBounds } from '../sim/colliders.js';
import { driveCommand } from './drive.js';
import type { VehicleCatalog } from './spec.js';
import { VehicleBody } from './vehicleBody.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../../../world/vehicles.json', import.meta.url), 'utf8'),
) as VehicleCatalog;
const DT = 1 / 20;
const SUB = 3; // the server sub-steps physics inside each 20 Hz tick

function rig(kind: string, extra: (w: RAPIER.World) => void = () => {}) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addWorldBounds(RAPIER, world);
  extra(world);
  const v = new VehicleBody(RAPIER, world, catalog.kinds[kind]!, [200, 0.3, 200], 0);
  world.timestep = DT / SUB;
  const run = (keys: number, seconds: number, parked = false) => {
    for (let t = 0; t < seconds / DT; t++) {
      v.drive(driveCommand(keys, v.speed, v.spec, parked), DT);
      for (let i = 0; i < SUB; i++) {
        v.update(DT / SUB);
        world.step();
      }
    }
  };
  run(0, 1, true); // settle on the suspension
  return { v, run, world };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe.each(['sedan', 'motorbike'])('%s', (kind) => {
  it('rests on its wheels', () => {
    const { v } = rig(kind);
    const p = v.pose();
    expect(p.y).toBeGreaterThan(-0.1);
    expect(p.y).toBeLessThan(0.6);
  });

  it('drives forward (+Z at yaw 0) under throttle', () => {
    const { v, run } = rig(kind);
    run(Key.Forward, 3);
    expect(v.speed).toBeGreaterThan(5);
    expect(v.pose().z).toBeGreaterThan(208);
    expect(Math.abs(v.pose().x - 200)).toBeLessThan(1.5);
  });

  it('brakes to a stop with S, then reverses if S stays held', () => {
    const { v, run } = rig(kind);
    run(Key.Forward, 3);
    const top = v.speed;
    let stoppedAfter = Infinity;
    for (let t = 0; t < 60 && stoppedAfter === Infinity; t++) {
      run(Key.Back, DT);
      if (Math.abs(v.speed) < 1) stoppedAfter = (t + 1) * DT;
    }
    expect(top).toBeGreaterThan(8);
    expect(stoppedAfter).toBeLessThan(2.5);
    run(Key.Back, 1.5);
    expect(v.speed).toBeLessThan(-1);
  });

  it('turns left when steering left', () => {
    const { v, run } = rig(kind);
    run(Key.Forward, 1.5);
    run(Key.Forward | Key.Left, 2);
    // Facing +Z, left is +X; yaw grows counter-clockwise seen from above.
    expect(v.pose().x).toBeGreaterThan(201);
    expect(v.yaw).toBeGreaterThan(0.3);
  });

  it('stays upright through a hard turn', () => {
    const { v, run } = rig(kind);
    run(Key.Forward, 2.5);
    run(Key.Forward | Key.Right, 3);
    const up = v.toWorld([0, 1, 0]);
    const t = v.pose();
    expect(up[1] - t.y).toBeGreaterThan(0.9);
  });
});

describe('exiting', () => {
  it('uses the first free exit and skips blocked ones', () => {
    const { v } = rig('sedan');
    const left = v.findExit()!;
    expect(left[0]).toBeGreaterThan(201); // driver side (+X)

    const boxed = rig('sedan', (w) => {
      addProxy(RAPIER, w, { type: 'box', pos: [202.2, 1, 200], half: [0.5, 1, 3] });
    });
    const other = boxed.v.findExit()!;
    expect(other[0]).toBeLessThan(199); // passenger side instead
  });

  it('refuses to exit when boxed in on every side', () => {
    const { v } = rig('sedan', (w) => {
      addProxy(RAPIER, w, { type: 'box', pos: [202.2, 1, 200], half: [0.5, 1, 5] });
      addProxy(RAPIER, w, { type: 'box', pos: [197.8, 1, 200], half: [0.5, 1, 5] });
      addProxy(RAPIER, w, { type: 'box', pos: [200, 1, 203.6], half: [3, 1, 0.5] });
      addProxy(RAPIER, w, { type: 'box', pos: [200, 1, 196.4], half: [3, 1, 0.5] });
    });
    expect(v.findExit()).toBeUndefined();
  });
});

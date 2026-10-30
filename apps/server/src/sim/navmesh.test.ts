import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WorldDef } from '@town/shared';
import { Navmesh } from './navmesh.js';

const town = JSON.parse(
  readFileSync(new URL('../../../../world/town.json', import.meta.url), 'utf8'),
) as WorldDef;

describe('pedestrian navmesh', () => {
  const nav = new Navmesh(town);

  it('bakes a sidewalk network', () => {
    expect(nav.polygons).toBeGreaterThan(5000);
  });

  it('finds a path across town that stays on the network', () => {
    const a = nav.randomPoint([60, 0, 60], 30);
    const b = nav.randomPoint([380, 0, 380], 30);
    const path = nav.path(a, b);
    expect(path.length).toBeGreaterThan(1);
    const end = path[path.length - 1]!;
    expect(Math.hypot(end[0] - b[0], end[2] - b[2])).toBeLessThan(3);
  });

  it('keeps random points near where they were asked for', () => {
    for (let i = 0; i < 20; i++) {
      const p = nav.randomPoint([228, 0, 228], 40);
      expect(Math.hypot(p[0] - 228, p[2] - 228)).toBeLessThan(60);
    }
  });
});

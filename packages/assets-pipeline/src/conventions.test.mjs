import { describe, expect, it } from 'vitest';
import { inspect, stripForLevel } from './conventions.mjs';
import { makeAsset } from './fixtures.mjs';

describe('inspect', () => {
  it('turns COL_ nodes into boxes (with their transforms) and leaves them out of the bounds', () => {
    const doc = makeAsset([
      { name: 'house', size: [6, 4, 5] },
      { name: 'COL_walls', size: [2, 1, 1], translation: [1, 0, -1], scale: [3, 4, 5] },
    ]);
    const r = inspect(doc, { name: 'house' });
    expect(r.colliders).toEqual([{ center: [1, 2, -1], half: [3, 2, 2.5] }]);
    expect(r.bounds).toEqual({ min: [-3, 0, -2.5], max: [3, 4, 2.5] });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('finds LOD levels, measures LOD0 only, and rejects gaps', () => {
    const ok = inspect(
      makeAsset([
        { name: 'tree_LOD0', size: [1, 5, 1] },
        { name: 'tree_LOD1', size: [1, 5, 1] },
        { name: 'tree_LOD2', size: [1, 5, 1] },
      ]),
      { name: 'tree' },
    );
    expect(ok.lods).toEqual([0, 1, 2]);
    expect(ok.tris).toBe(12); // one box at LOD0
    const gap = inspect(
      makeAsset([
        { name: 'a_LOD0', size: [1, 1, 1] },
        { name: 'a_LOD2', size: [1, 1, 1] },
      ]),
    );
    expect(gap.errors.join()).toMatch(/skip/);
    const noZero = inspect(makeAsset([{ name: 'a_LOD1', size: [1, 1, 1] }]));
    expect(noZero.errors.join()).toMatch(/LOD0/);
  });

  it('catches the classic export mistakes', () => {
    expect(inspect(makeAsset([{ name: 'm', size: [400, 300, 400] }])).errors.join()).toMatch(
      /centimetres/,
    );
    expect(inspect(makeAsset([{ name: 'm', size: [0.001, 0.001, 0.001] }])).errors.join()).toMatch(
      /scale/,
    );
    expect(inspect(makeAsset([{ name: 'm', size: [1, 1, 1], lift: 2 }])).warnings.join()).toMatch(
      /origin/,
    );
    expect(inspect(makeAsset([{ name: 'COL_only', size: [1, 1, 1] }])).errors.join()).toMatch(
      /no renderable/,
    );
    expect(
      inspect(makeAsset([{ name: 'm', size: [1, 1, 1] }]), { name: 'My House' }).warnings.join(),
    ).toMatch(/kebab/);
  });

  it('strict mode makes convention warnings errors; checks can be switched off', () => {
    const lifted = makeAsset([{ name: 'm', size: [1, 1, 1], lift: 2 }]);
    expect(inspect(lifted, { strict: true }).errors.join()).toMatch(/origin/);
    expect(inspect(lifted, { strict: true, checks: { origin: false } }).errors).toEqual([]);
  });

  it('enforces the triangle budget', () => {
    const doc = makeAsset([{ name: 'm', size: [1, 1, 1] }]);
    expect(
      inspect(doc, { budget: { tris: 10, textureSize: 1024, materials: 4 } }).warnings.join(),
    ).toMatch(/triangles/);
  });
});

describe('stripForLevel', () => {
  it('drops collision proxies and other LODs from a render file', () => {
    const doc = makeAsset([
      { name: 'car_LOD0', size: [2, 1, 4] },
      { name: 'car_LOD1', size: [2, 1, 4] },
      { name: 'COL_body', size: [2, 1, 4] },
      { name: 'wheel', size: [0.5, 0.5, 0.5] },
    ]);
    stripForLevel(doc, 1);
    expect(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName())
        .sort(),
    ).toEqual(['car_LOD1', 'wheel']);
  });
});

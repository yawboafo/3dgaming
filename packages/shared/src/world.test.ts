import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WORLD_CHUNKS } from './chunks.js';
import type { AssetManifest, WorldDef } from './world.js';

const read = <T>(p: string): T =>
  JSON.parse(readFileSync(new URL(`../../../world/${p}`, import.meta.url), 'utf8')) as T;
const town = read<WorldDef>('town.json');
const assets = read<AssetManifest>('assets.json');

/** Axis-aligned footprint of a yaw-rotated box (rotY in 90° steps for Phase 0 data). */
function footprint(pos: number[], half: number[], rotY = 0) {
  const swap = Math.round(rotY / 90) % 2 !== 0;
  const hx = swap ? half[2]! : half[0]!;
  const hz = swap ? half[0]! : half[2]!;
  return { x0: pos[0]! - hx, x1: pos[0]! + hx, z0: pos[2]! - hz, z1: pos[2]! + hz };
}

describe('world/town.json', () => {
  it('covers the chunk grid exactly once', () => {
    const keys = new Set(town.chunks.map((c) => `${c.cx},${c.cz}`));
    expect(keys.size).toBe(WORLD_CHUNKS * WORLD_CHUNKS);
    expect(town.chunkSize).toBe(CHUNK_SIZE);
  });

  it('only references assets in the manifest, inside their chunk', () => {
    for (const c of town.chunks) {
      for (const p of c.props) {
        expect(assets.assets[p.asset], p.asset).toBeDefined();
        expect(Math.floor(p.pos[0] / CHUNK_SIZE)).toBe(c.cx);
        expect(Math.floor(p.pos[2] / CHUNK_SIZE)).toBe(c.cz);
      }
    }
  });

  it('spawns the player clear of every collider', () => {
    const [sx, , sz] = town.spawn;
    for (const c of town.chunks) {
      for (const col of c.colliders) {
        if (col.type !== 'box') continue;
        const f = footprint(col.pos, col.half, col.rotY);
        const inside = sx > f.x0 - 0.5 && sx < f.x1 + 0.5 && sz > f.z0 - 0.5 && sz < f.z1 + 0.5;
        expect(inside, `spawn inside collider at ${col.pos}`).toBe(false);
      }
    }
  });

  it('keeps buildings off the roads', () => {
    const roads = town.chunks.flatMap((c) => c.props.filter((p) => p.asset.startsWith('road-')));
    const houses = town.chunks
      .flatMap((c) => c.colliders)
      .filter((c) => c.type === 'box' && c.half[1] > 2 && Math.min(c.half[0], c.half[2]) > 1);
    for (const h of houses) {
      if (h.type !== 'box') continue;
      const f = footprint(h.pos, h.half, h.rotY);
      for (const r of roads) {
        const overlap =
          r.pos[0] + 4 > f.x0 && r.pos[0] - 4 < f.x1 && r.pos[2] + 4 > f.z0 && r.pos[2] - 4 < f.z1;
        expect(overlap, `building at ${h.pos} overlaps road at ${r.pos}`).toBe(false);
      }
    }
  });
});

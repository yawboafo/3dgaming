import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WORLD_CHUNKS } from './chunks.js';
import type { AssetManifest, InteriorDef, WorldDef } from './world.js';

const read = <T>(p: string): T =>
  JSON.parse(readFileSync(new URL(`../../../world/${p}`, import.meta.url), 'utf8')) as T;
const town = read<WorldDef>('town.json');
const assets = read<AssetManifest>('assets.json');
const interiors = town.interiors.map((id) => read<InteriorDef>(`interiors/${id}.json`));
const allBoxes = town.chunks.flatMap((c) => c.colliders);

function insideAny(x: number, z: number, margin: number): boolean {
  return allBoxes.some((col) => {
    if (col.type !== 'box') return false;
    const f = footprint(col.pos, col.half, col.rotY);
    return x > f.x0 - margin && x < f.x1 + margin && z > f.z0 - margin && z < f.z1 + margin;
  });
}

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

describe('enterable buildings', () => {
  const doors = town.chunks.flatMap((c) => c.interactables ?? []);

  it('has at least three doors, each leading to an interior file with a matching id', () => {
    expect(doors.length).toBeGreaterThanOrEqual(3);
    for (const d of doors) {
      expect(d.action.type).toBe('enter');
      if (d.action.type !== 'enter') continue;
      const target = d.action.interior;
      expect(
        interiors.find((i) => i.id === target),
        target,
      ).toBeDefined();
    }
  });

  it('puts the player back outside on clear ground', () => {
    for (const d of doors) {
      if (d.action.type !== 'enter') continue;
      const [x, , z] = d.action.exitPos;
      expect(insideAny(x, z, 0.4), `exit of ${d.id}`).toBe(false);
    }
  });

  it('spawns inside each room, clear of furniture, with a way out', () => {
    for (const r of interiors) {
      const floor = r.boxes[0]!;
      const [sx, , sz] = r.spawn;
      expect(Math.abs(sx)).toBeLessThan(floor.half[0]);
      expect(Math.abs(sz)).toBeLessThan(floor.half[2]);
      for (const b of r.boxes.slice(1)) {
        if (b.collide === false || b.pos[1] - b.half[1] > 1.8) continue;
        const hit =
          Math.abs(sx - b.pos[0]) < b.half[0] + 0.4 && Math.abs(sz - b.pos[2]) < b.half[2] + 0.4;
        expect(hit, `${r.id} spawn inside box at ${b.pos}`).toBe(false);
      }
      expect(
        r.interactables.some((i) => i.action.type === 'exit'),
        r.id,
      ).toBe(true);
    }
  });

  it('keeps interiors far from the town and from each other', () => {
    for (const r of interiors) expect(Math.hypot(r.origin[0], r.origin[2])).toBeGreaterThan(1500);
    const origins = new Set(interiors.map((r) => r.origin.join(',')));
    expect(origins.size).toBe(interiors.length);
  });
});

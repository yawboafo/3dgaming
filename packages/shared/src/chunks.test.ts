import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  chunkKey,
  parseChunkKey,
  streamDiff,
  worldToChunk,
  zoneOf,
  chunksInRadius,
} from './chunks.js';

describe('chunk grid', () => {
  it('maps world positions to chunks', () => {
    expect(worldToChunk(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunk(CHUNK_SIZE - 0.01, CHUNK_SIZE)).toEqual({ cx: 0, cz: 1 });
    expect(worldToChunk(-1, 130)).toEqual({ cx: -1, cz: 2 });
  });

  it('round-trips keys', () => {
    expect(parseChunkKey(chunkKey({ cx: 3, cz: 5 }))).toEqual({ cx: 3, cz: 5 });
    expect(() => parseChunkKey('nope')).toThrow();
  });

  it('clips the load ring to the world', () => {
    expect(chunksInRadius({ cx: 0, cz: 0 }, 1)).toHaveLength(4);
    expect(chunksInRadius({ cx: 3, cz: 3 }, 1)).toHaveLength(9);
  });

  it('applies 1-chunk hysteresis', () => {
    const first = streamDiff({ cx: 3, cz: 3 }, new Set());
    expect(first.load).toHaveLength(9);
    const loaded = new Set(first.load.map(chunkKey));

    // Step one chunk east: new column loads, nothing unloads yet.
    const step = streamDiff({ cx: 4, cz: 3 }, loaded);
    expect(step.load).toHaveLength(3);
    expect(step.unload).toHaveLength(0);
    step.load.forEach((c) => loaded.add(chunkKey(c)));

    // Two chunks east of the original: the western column is now 3 away and unloads.
    const far = streamDiff({ cx: 5, cz: 3 }, loaded);
    expect(far.unload.map(chunkKey).sort()).toEqual(['2,2', '2,3', '2,4']);
  });

  it('groups 2×2 chunk blocks into zones', () => {
    expect(zoneOf({ cx: 0, cz: 1 })).toBe(zoneOf({ cx: 1, cz: 0 }));
    expect(zoneOf({ cx: 2, cz: 0 })).not.toBe(zoneOf({ cx: 1, cz: 0 }));
  });
});

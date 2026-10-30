/** Chunk grid: the world is split into square chunks on the XZ plane, origin at the world's min corner. */
export const CHUNK_SIZE = 64;
/** Town is ~400 m; 7 × 64 = 448 m keeps chunk edges on whole numbers. */
export const WORLD_CHUNKS = 7;
export const WORLD_SIZE = CHUNK_SIZE * WORLD_CHUNKS;
/** Chunks within this ring of the player are loaded… */
export const STREAM_RADIUS = 1;
/** …and stay loaded until they're this far away (1-chunk hysteresis). */
export const UNLOAD_RADIUS = STREAM_RADIUS + 1;
/** Interest management: clients receive entities within this many chunks. */
export const INTEREST_RADIUS = 2;
/** One zone room per ZONE_CHUNKS × ZONE_CHUNKS block of chunks. */
export const ZONE_CHUNKS = 2;

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export function chunkKey(c: ChunkCoord): string {
  return `${c.cx},${c.cz}`;
}

export function parseChunkKey(key: string): ChunkCoord {
  const [cx, cz] = key.split(',').map(Number);
  if (cx === undefined || cz === undefined || Number.isNaN(cx) || Number.isNaN(cz)) {
    throw new Error(`Bad chunk key: ${key}`);
  }
  return { cx, cz };
}

export function worldToChunk(x: number, z: number): ChunkCoord {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}

export function inWorld(c: ChunkCoord): boolean {
  return c.cx >= 0 && c.cz >= 0 && c.cx < WORLD_CHUNKS && c.cz < WORLD_CHUNKS;
}

/** Chebyshev distance in chunks — matches the square load ring. */
export function chunkDistance(a: ChunkCoord, b: ChunkCoord): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cz - b.cz));
}

export function chunksInRadius(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const c = { cx: center.cx + dx, cz: center.cz + dz };
      if (inWorld(c)) out.push(c);
    }
  }
  return out;
}

export interface StreamDiff {
  load: ChunkCoord[];
  unload: ChunkCoord[];
}

/**
 * Decide which chunks to load/unload given the currently loaded set.
 * Load everything within STREAM_RADIUS; unload only beyond UNLOAD_RADIUS so that
 * walking back and forth across a border does not thrash.
 */
export function streamDiff(center: ChunkCoord, loaded: ReadonlySet<string>): StreamDiff {
  const load = chunksInRadius(center, STREAM_RADIUS).filter((c) => !loaded.has(chunkKey(c)));
  const unload: ChunkCoord[] = [];
  for (const key of loaded) {
    const c = parseChunkKey(key);
    if (chunkDistance(c, center) > UNLOAD_RADIUS) unload.push(c);
  }
  return { load, unload };
}

export function zoneOf(c: ChunkCoord): string {
  return `zone_${Math.floor(c.cx / ZONE_CHUNKS)}_${Math.floor(c.cz / ZONE_CHUNKS)}`;
}

export const ZONE_SIZE = ZONE_CHUNKS * CHUNK_SIZE;

export interface ZoneBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** World-space rectangle a zone room owns. */
export function zoneBounds(zone: string): ZoneBounds {
  const m = /^zone_(\d+)_(\d+)$/.exec(zone);
  if (!m) throw new Error(`Bad zone id: ${zone}`);
  const i = Number(m[1]);
  const j = Number(m[2]);
  return { x0: i * ZONE_SIZE, x1: (i + 1) * ZONE_SIZE, z0: j * ZONE_SIZE, z1: (j + 1) * ZONE_SIZE };
}

export function inZone(b: ZoneBounds, x: number, z: number, margin = 0): boolean {
  return x >= b.x0 - margin && x < b.x1 + margin && z >= b.z0 - margin && z < b.z1 + margin;
}

export function zoneAt(x: number, z: number): string {
  return zoneOf(worldToChunk(x, z));
}

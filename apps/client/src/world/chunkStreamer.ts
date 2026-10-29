import { chunkKey, streamDiff, worldToChunk, type ChunkDef, type WorldDef } from '@town/shared';

export interface ChunkSink {
  addChunk(chunk: ChunkDef): void | Promise<void>;
  removeChunk(chunk: ChunkDef): void;
}

/**
 * Streams chunks around a point with 1-chunk hysteresis (see shared streamDiff). Loads run one
 * at a time so a burst of new chunks can't stall a frame.
 */
export class ChunkStreamer {
  private readonly defs = new Map<string, ChunkDef>();
  private readonly loaded = new Set<string>();
  private readonly pending = new Set<string>();
  private busy = false;
  lastLoadMs = 0;
  maxLoadMs = 0;

  constructor(
    town: WorldDef,
    private readonly sinks: ChunkSink[],
  ) {
    for (const c of town.chunks) this.defs.set(chunkKey(c), c);
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  update(x: number, z: number): void {
    const { load, unload } = streamDiff(
      worldToChunk(x, z),
      new Set([...this.loaded, ...this.pending]),
    );
    for (const c of unload) {
      const key = chunkKey(c);
      const def = this.defs.get(key);
      if (!def || !this.loaded.delete(key)) continue;
      for (const s of this.sinks) s.removeChunk(def);
    }
    for (const c of load) this.pending.add(chunkKey(c));
    void this.pump();
  }

  /** Resolves once nothing is pending — used at boot so the first frame has the town. */
  async settle(): Promise<void> {
    while (this.pending.size > 0 || this.busy) await new Promise((r) => setTimeout(r, 16));
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const key of this.pending) {
        this.pending.delete(key);
        const def = this.defs.get(key);
        if (!def || this.loaded.has(key)) continue;
        const t0 = performance.now();
        await Promise.all(this.sinks.map((s) => s.addChunk(def)));
        this.lastLoadMs = performance.now() - t0;
        this.maxLoadMs = Math.max(this.maxLoadMs, this.lastLoadMs);
        this.loaded.add(key);
      }
    } finally {
      this.busy = false;
    }
    if (this.pending.size > 0) void this.pump();
  }
}

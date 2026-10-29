import RAPIER from '@dimforge/rapier3d-compat';
import {
  GRAVITY,
  addChunkColliders,
  addInteriorColliders,
  addWorldBounds,
  chunkKey,
  type ChunkDef,
  type InteriorDef,
} from '@town/shared';

/**
 * Client-side Rapier world holding only the streamed-in chunks' (and current interior's) colliders. Used for queries
 * (camera boom collision) now and for local-player prediction in deliverable 7. It is never
 * stepped from requestAnimationFrame.
 */
export class ClientPhysics {
  private constructor(readonly world: RAPIER.World) {}
  private readonly byChunk = new Map<string, RAPIER.Collider[]>();

  static async create(): Promise<ClientPhysics> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    addWorldBounds(RAPIER, world);
    const p = new ClientPhysics(world);
    p.refresh();
    return p;
  }

  addChunk(chunk: ChunkDef): void {
    this.byChunk.set(chunkKey(chunk), addChunkColliders(RAPIER, this.world, chunk));
    this.refresh();
  }

  removeChunk(chunk: ChunkDef): void {
    const key = chunkKey(chunk);
    for (const c of this.byChunk.get(key) ?? []) this.world.removeCollider(c, false);
    this.byChunk.delete(key);
    this.refresh();
  }

  addInterior(def: InteriorDef): void {
    this.byChunk.set(`interior:${def.id}`, addInteriorColliders(RAPIER, this.world, def));
    this.refresh();
  }

  removeInterior(id: string): void {
    const key = `interior:${id}`;
    for (const c of this.byChunk.get(key) ?? []) this.world.removeCollider(c, false);
    this.byChunk.delete(key);
    this.refresh();
  }

  /** Distance along the ray to the first hit, or maxDist if clear. */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
  ): number {
    const hit = this.world.castRay(new RAPIER.Ray(origin, dir), maxDist, true);
    return hit ? hit.timeOfImpact : maxDist;
  }

  /** Scene queries read the broad phase, which only updates on a step; a zero-length step is cheap. */
  private refresh(): void {
    this.world.timestep = 0;
    this.world.step();
  }
}

/** Types for world/town.json — data, not code, so a Blender export can replace placeholders. */
export type Vec3 = [number, number, number];

export interface PropInstance {
  asset: string;
  pos: Vec3;
  /** Yaw in degrees — props sit on flat ground. */
  rotY: number;
  scale?: number;
}

export type CollisionProxy =
  | { type: 'box'; pos: Vec3; half: Vec3; rotY?: number }
  | { type: 'mesh'; asset: string; pos: Vec3; rotY?: number };

export interface ChunkDef {
  cx: number;
  cz: number;
  props: PropInstance[];
  colliders: CollisionProxy[];
}

export interface WorldDef {
  version: 1;
  chunkSize: number;
  chunks: ChunkDef[];
  spawn: Vec3;
}

export interface AssetDef {
  /** Path to the .glb relative to the asset root; omitted = use the primitive fallback. */
  url?: string;
  /** Fallback primitive while real art is missing. */
  placeholder?: { shape: 'box' | 'cylinder'; size: Vec3; color: string };
}

export interface AssetManifest {
  version: 1;
  assets: Record<string, AssetDef>;
}

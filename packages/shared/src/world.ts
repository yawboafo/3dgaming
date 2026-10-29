/** Types for world/town.json — data, not code, so a Blender export can replace placeholders. */
export type Vec3 = [number, number, number];

export interface PropInstance {
  asset: string;
  pos: Vec3;
  /** Yaw in degrees — props sit on flat ground. */
  rotY: number;
  /** Multiplies the asset's base scale. */
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
  /** Doors and other things the player can use, in world coordinates. */
  interactables?: InteractableDef[];
}

/** What pressing E on an interactable does. Resolved on the server only. */
export type InteractAction =
  | { type: 'enter'; interior: string; exitPos: Vec3; exitYaw: number }
  | { type: 'exit' }
  | { type: 'vehicle'; vehicle: string };

export interface InteractableDef {
  id: string;
  pos: Vec3;
  /** Metres from the player's feet. */
  range: number;
  /** Shown after the key hint, e.g. "Enter Kofi's Provisions". */
  prompt: string;
  action: InteractAction;
}

/** A coloured box: floor, wall, counter… Visual and (unless collide is false) collision. */
export interface InteriorBox {
  pos: Vec3;
  half: Vec3;
  color: string;
  collide?: boolean;
}

/**
 * An enterable building's inside: a separate sub-scene loaded on demand. All positions are local
 * to `origin`, which places the room far from the town in the shared physics world.
 */
export interface InteriorDef {
  version: 1;
  id: string;
  name: string;
  origin: Vec3;
  boxes: InteriorBox[];
  props?: PropInstance[];
  lights: { pos: Vec3; color: string; intensity: number }[];
  spawn: Vec3;
  spawnYaw: number;
  interactables: InteractableDef[];
}

export interface WorldDef {
  version: 1;
  chunkSize: number;
  /** Flat heightmap for Phase 0; a sampled grid can replace it later. */
  terrain: { type: 'flat'; height: number };
  chunks: ChunkDef[];
  spawn: Vec3;
  spawnYaw: number;
  /** Server-owned vehicles placed at startup (kinds from world/vehicles.json). */
  vehicles: { kind: string; pos: Vec3; rotY: number }[];
  /** Interior ids (world/interiors/<id>.json) reachable from this town. */
  interiors: string[];
}

export type ColliderKind = 'box' | 'trunk' | 'none';

export interface AssetDef {
  /** Path to the .glb relative to the asset root; omitted = use the primitive fallback. */
  url?: string;
  /** Base scale applied to every instance (uniform or per-axis). Defaults to 1. */
  scale?: number | Vec3;
  /** How the town generator builds this asset's collision proxy. Defaults to 'box'. */
  collider?: ColliderKind;
  /** Fallback primitive while real art is missing. */
  placeholder?: { shape: 'box' | 'cylinder'; size: Vec3; color: string };
}

export interface AssetManifest {
  version: 1;
  assets: Record<string, AssetDef>;
}

import { addComponent, addEntity, createWorld, query, removeEntity, type World } from 'bitecs';
import type { InteractableDef, InteriorDef, Vec3, WorldDef } from '../world.js';

/** The outdoor space; interiors use their id. */
export const TOWN_SPACE = 'town';

export interface InteractableRecord {
  def: InteractableDef;
  space: string;
  /** Disabled interactables are skipped (e.g. a vehicle someone is already driving). */
  enabled: boolean;
}

/** bitecs world holding every interactable as Position + Interactable. Shared by client and server. */
export function createInteractionWorld() {
  return createWorld({
    components: {
      Position: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Interactable: [] as InteractableRecord[],
    },
  });
}

export type InteractionWorld = ReturnType<typeof createInteractionWorld>;

export function addInteractable(
  world: InteractionWorld,
  def: InteractableDef,
  space: string,
  origin: Vec3 = [0, 0, 0],
): number {
  const { Position, Interactable } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Interactable);
  Position.x[eid] = def.pos[0] + origin[0];
  Position.y[eid] = def.pos[1] + origin[1];
  Position.z[eid] = def.pos[2] + origin[2];
  Interactable[eid] = { def, space, enabled: true };
  return eid;
}

/** For things that move (vehicles): update position and availability in place. */
export function updateInteractable(
  world: InteractionWorld,
  eid: number,
  x: number,
  y: number,
  z: number,
  enabled: boolean,
): void {
  const { Position, Interactable } = world.components;
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  const rec = Interactable[eid];
  if (rec) rec.enabled = enabled;
}

export function addTownInteractables(world: InteractionWorld, town: WorldDef): void {
  for (const c of town.chunks)
    for (const d of c.interactables ?? []) addInteractable(world, d, TOWN_SPACE);
}

/** Returns the entity ids added, so a client can drop them when the interior unloads. */
export function addInteriorInteractables(world: InteractionWorld, interior: InteriorDef): number[] {
  return interior.interactables.map((d) => addInteractable(world, d, interior.id, interior.origin));
}

export function removeInteractables(world: InteractionWorld, eids: number[]): void {
  for (const eid of eids) removeEntity(world as World, eid);
}

/** Nearest interactable in `space` whose range covers the point, or undefined. */
export function nearestInteractable(
  world: InteractionWorld,
  space: string,
  x: number,
  y: number,
  z: number,
): InteractableRecord | undefined {
  const { Position, Interactable } = world.components;
  let best: InteractableRecord | undefined;
  let bestD = Infinity;
  for (const eid of query(world, [Position, Interactable])) {
    const rec = Interactable[eid]!;
    if (rec.space !== space || !rec.enabled) continue;
    const d = Math.hypot(Position.x[eid]! - x, (Position.y[eid]! - y) * 0.5, Position.z[eid]! - z);
    if (d <= rec.def.range && d < bestD) {
      best = rec;
      bestD = d;
    }
  }
  return best;
}

/** True on the step a key goes down, so holding E doesn't re-trigger every tick. */
export function pressed(keys: number, prevKeys: number, key: number): boolean {
  return (keys & key) !== 0 && (prevKeys & key) === 0;
}

/** Yaw that faces along (dx, dz), in the convention movementIntent and the camera share. */
export function yawFacing(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

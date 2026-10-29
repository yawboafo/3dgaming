import {
  Key,
  TOWN_SPACE,
  addInteriorInteractables,
  addTownInteractables,
  createInteractionWorld,
  nearestInteractable,
  pressed,
  type CharacterMotor,
  type InteractAction,
  type InteriorDef,
  type PlayerState,
  type WorldDef,
} from '@town/shared';

type EnterAction = Extract<InteractAction, { type: 'enter' }>;

/**
 * Server side of the Interactable component: on the step E goes down, run the action of the
 * nearest interactable in the player's space. The client only ever shows the prompt.
 */
export class InteractionSystem {
  private readonly ecs = createInteractionWorld();
  private readonly interiors = new Map<string, InteriorDef>();
  /** interior id → the town door that leads into it (where "exit" puts you). */
  private readonly doorFor = new Map<string, EnterAction>();
  private readonly prevKeys = new Map<string, number>();

  constructor(
    town: WorldDef,
    interiors: InteriorDef[],
    private readonly motor: CharacterMotor,
  ) {
    addTownInteractables(this.ecs, town);
    for (const i of interiors) {
      this.interiors.set(i.id, i);
      addInteriorInteractables(this.ecs, i);
    }
    for (const c of town.chunks)
      for (const d of c.interactables ?? [])
        if (d.action.type === 'enter') this.doorFor.set(d.action.interior, d.action);
  }

  /** Call once per step per player with that step's keys, after movement. */
  update(sid: string, p: PlayerState, keys: number): void {
    const prev = this.prevKeys.get(sid) ?? 0;
    this.prevKeys.set(sid, keys);
    if (!pressed(keys, prev, Key.Interact) || p.vehicle) return;
    const hit = nearestInteractable(this.ecs, p.space, p.x, p.y, p.z);
    if (hit) this.run(sid, p, hit.def.action);
  }

  forget(sid: string): void {
    this.prevKeys.delete(sid);
  }

  private run(sid: string, p: PlayerState, action: InteractAction): void {
    if (action.type === 'enter') {
      const room = this.interiors.get(action.interior);
      if (!room) return;
      const [ox, oy, oz] = room.origin;
      this.motor.teleport(
        sid,
        p,
        ox + room.spawn[0],
        oy + room.spawn[1],
        oz + room.spawn[2],
        room.spawnYaw,
      );
      p.space = room.id;
    } else {
      const door = this.doorFor.get(p.space);
      if (!door) return;
      this.motor.teleport(sid, p, door.exitPos[0], door.exitPos[1], door.exitPos[2], door.exitYaw);
      p.space = TOWN_SPACE;
    }
  }
}

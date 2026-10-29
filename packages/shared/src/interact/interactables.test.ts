import { describe, expect, it } from 'vitest';
import { Key } from '../messages.js';
import type { InteractableDef, InteriorDef } from '../world.js';
import {
  TOWN_SPACE,
  addInteractable,
  addInteriorInteractables,
  createInteractionWorld,
  nearestInteractable,
  pressed,
  removeInteractables,
} from './interactables.js';

const door = (id: string, x: number, range = 2): InteractableDef => ({
  id,
  pos: [x, 0, 0],
  range,
  prompt: id,
  action: { type: 'exit' },
});

describe('interactables', () => {
  it('finds the nearest in range, in the same space only', () => {
    const w = createInteractionWorld();
    addInteractable(w, door('a', 0), TOWN_SPACE);
    addInteractable(w, door('b', 1.5), TOWN_SPACE);
    addInteractable(w, door('c', 1), 'chop-bar');
    expect(nearestInteractable(w, TOWN_SPACE, 1.2, 0, 0)?.def.id).toBe('b');
    expect(nearestInteractable(w, TOWN_SPACE, 10, 0, 0)).toBeUndefined();
    expect(nearestInteractable(w, 'chop-bar', 1.2, 0, 0)?.def.id).toBe('c');
  });

  it('offsets interior interactables by the interior origin and can drop them', () => {
    const w = createInteractionWorld();
    const interior = {
      id: 'x',
      origin: [100, 0, 0],
      interactables: [door('exit', 1)],
    } as unknown as InteriorDef;
    const eids = addInteriorInteractables(w, interior);
    expect(nearestInteractable(w, 'x', 101, 0, 0)?.def.id).toBe('exit');
    expect(nearestInteractable(w, 'x', 1, 0, 0)).toBeUndefined();
    removeInteractables(w, eids);
    expect(nearestInteractable(w, 'x', 101, 0, 0)).toBeUndefined();
  });

  it('detects key presses on the down edge only', () => {
    expect(pressed(Key.Interact, 0, Key.Interact)).toBe(true);
    expect(pressed(Key.Interact, Key.Interact, Key.Interact)).toBe(false);
    expect(pressed(0, Key.Interact, Key.Interact)).toBe(false);
  });
});

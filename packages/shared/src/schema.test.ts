import { describe, expect, it } from 'vitest';
import { InputSchema, PLAYER, PlayerState, TownState } from './index.js';

describe('schema defaults', () => {
  it('never leaves numeric fields undefined', () => {
    for (const inst of [new PlayerState(), new TownState(), new InputSchema()]) {
      for (const [k, v] of Object.entries(inst.toJSON())) {
        expect(v, k).not.toBeUndefined();
        if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
      }
    }
    expect(new PlayerState().health).toBe(PLAYER.maxHealth);
  });
});

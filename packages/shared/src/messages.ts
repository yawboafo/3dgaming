/** Bit flags for held keys in an input frame. */
export const Key = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Sprint: 1 << 4,
  Jump: 1 << 5,
  Fire: 1 << 6,
  Reload: 1 << 7,
  Interact: 1 << 8,
  Handbrake: 1 << 9,
  Weapon1: 1 << 10,
  Weapon2: 1 << 11,
} as const;

/** Plain shape of one input frame (mirrors InputSchema) — used for validation and tests. */
export interface InputFrame {
  seq: number;
  dt: number;
  keys: number;
  /** Camera yaw/pitch in radians — movement is relative to yaw, shots use both. */
  yaw: number;
  pitch: number;
}

export function hasKey(keys: number, key: number): boolean {
  return (keys & key) !== 0;
}

/** Reject obviously bad input before it reaches the simulation. */
export function isValidInput(f: unknown): f is InputFrame {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  return (
    Number.isInteger(o.seq) &&
    typeof o.dt === 'number' &&
    o.dt > 0 &&
    o.dt <= 0.1 &&
    Number.isInteger(o.keys) &&
    typeof o.yaw === 'number' &&
    Number.isFinite(o.yaw) &&
    typeof o.pitch === 'number' &&
    Number.isFinite(o.pitch)
  );
}

/** Server → client messages (state itself is delta-synced through the schema). */
export const ServerMsg = {
  /** Diagnostics for the /debug overlay, once per second. */
  Stats: 'stats',
  /** A shot resolved (hitscan) or a projectile hit something: tracers, impacts, hit markers. */
  Shot: 'shot',
} as const;

export type HitKind = 'none' | 'world' | 'player' | 'npc' | 'prop' | 'vehicle';

export interface ShotEvent {
  shooter: string;
  weapon: number;
  /** Start and end of the visible path; for projectiles `from` is where the round was fired. */
  from: [number, number, number];
  to: [number, number, number];
  normal: [number, number, number];
  hit: HitKind;
  /** Entity id hit (player session, npc or prop id), '' otherwise. */
  target: string;
  damage: number;
}

export interface ServerStats {
  /** p95 of each tick's authoritative physics (all sub-steps) over the last second. */
  physicsStepMs: number;
  /** Worst tick in the same second (usually GC or scheduling, not physics). */
  physicsStepMaxMs: number;
  players: number;
}

/** Display name of the game. Rename the project here (and in package scopes) when it's chosen. */
export const GAME_NAME = 'Town';

/** Authoritative simulation rate on the server. */
export const SERVER_TICK_HZ = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_HZ;
export const SERVER_DT = 1 / SERVER_TICK_HZ;

/**
 * The client predicts at the server tick rate (one input = one fixed step on both ends)
 * and renders at display rate, interpolating between sim steps.
 */
export const RENDER_TARGET_HZ = 60;

/** Remote entities are rendered this far in the past so two snapshots are usually available. */
export const INTERPOLATION_DELAY_MS = 100;

export const MAX_PLAYERS_PER_ROOM = 32;

export const ROOM_TOWN = 'town';

export const GRAVITY = -9.81;

export const PLAYER = {
  walkSpeed: 3.0,
  sprintSpeed: 6.5,
  jumpSpeed: 5.0,
  capsuleRadius: 0.35,
  capsuleHalfHeight: 0.55,
  maxHealth: 100,
} as const;

/** Budgets from the Phase 0 brief, shown on the /debug overlay. */
export const BUDGETS = {
  fps: 60,
  physicsStepMs: 1.2,
  drawCalls: 300,
  initialDownloadMb: 15,
  chunkLoadMs: 100,
} as const;

import * as THREE from 'three';
import type { Room } from '@colyseus/sdk';
import { AIM_PIVOT_HEIGHT, type TownState } from '@town/shared';
import type { Combat } from '../game/combat.js';
import type { NpcViews } from '../game/npcViews.js';
import type { OrbitCamera } from '../game/orbitCamera.js';
import type { PlayerViews } from '../game/players.js';
import type { PropViews } from '../game/propViews.js';
import type { Spaces } from '../game/spaces.js';
import type { VehicleViews } from '../game/vehicleViews.js';
import type { PromptHud } from '../hud/prompt.js';
import type { ChunkStreamer } from '../world/chunkStreamer.js';

/** Read by the Playwright smoke test (e2e/global.d.ts mirrors it). Diagnostic only. */
export interface TownTestHook {
  sessionId: string;
  tick: number;
  seq: number;
  pos: () => { x: number; y: number; z: number } | undefined;
  /** Where the local player is drawn (predicted), vs `pos` (last server state). */
  drawnPos: () => { x: number; y: number; z: number } | undefined;
  views: () => number;
  chunks: () => number;
  locomotion: () => string | undefined;
  space: () => string;
  prompt: () => string;
  vehicle: () => string;
  vehicleSpeed: () => number;
  health: () => number;
  ammo: () => { weapon: number; mag: number; reserve: number; reloading: boolean };
  shotsFired: () => number;
  lastHit: () => string;
  propsAlive: () => number;
  /** Point the camera (and so the crosshair) at a world point — tests can't move the mouse. */
  aimAt: (x: number, y: number, z: number) => void;
  npcs: () => { drawn: number; fleeing: number; down: number; total: number; traffic: number };
  gunCheck: () => unknown;
}

declare global {
  interface Window {
    __town?: TownTestHook;
  }
}

export function installTestHook(d: {
  room: Room<unknown, TownState>;
  seq: () => number;
  views: PlayerViews;
  streamer: ChunkStreamer;
  spaces: Spaces;
  hud: PromptHud;
  vehicles: VehicleViews;
  combat: Combat;
  props: PropViews;
  npcs: NpcViews;
  orbit: OrbitCamera;
}): void {
  const { room } = d;
  const me = () => room.state.players.get(room.sessionId);
  window.__town = {
    sessionId: room.sessionId,
    get tick() {
      return room.state.tick;
    },
    get seq() {
      return d.seq();
    },
    pos: () => {
      const p = me();
      return p && { x: p.x, y: p.y, z: p.z };
    },
    drawnPos: () => {
      const o = d.views.get(room.sessionId);
      return o && { x: o.position.x, y: o.position.y, z: o.position.z };
    },
    views: () => d.views.size,
    chunks: () => d.streamer.loadedCount,
    locomotion: () => d.views.locomotion(room.sessionId),
    space: () => d.spaces.current,
    prompt: () => d.hud.current,
    vehicle: () => me()?.vehicle ?? '',
    vehicleSpeed: () => {
      const id = me()?.vehicle;
      return id ? d.vehicles.speed(id) : 0;
    },
    health: () => me()?.health ?? 0,
    ammo: () => d.combat.ammo,
    shotsFired: () => d.combat.shotsFired,
    lastHit: () => d.combat.lastHit,
    propsAlive: () => d.props.alive,
    gunCheck: () => d.views.gunCheck(room.sessionId),
    npcs: () => ({
      ...d.npcs.summary(),
      total: room.state.npcs.size,
      traffic: [...room.state.vehicles.keys()].filter((k) => k.startsWith('t.')).length,
    }),
    aimAt: (x, y, z) => {
      const p = me();
      if (!p) return;
      const v = new THREE.Vector3(x - p.x, y - (p.y + AIM_PIVOT_HEIGHT), z - p.z).normalize();
      d.orbit.yaw = Math.atan2(-v.x, -v.z);
      d.orbit.pitch = Math.asin(v.y);
    },
  };
}

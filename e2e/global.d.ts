/** Mirrors the diagnostic hook the client exposes in apps/client/src/main.ts. */
declare global {
  interface Window {
    __town?: {
      sessionId: string;
      tick: number;
      seq: number;
      pos: () => { x: number; y: number; z: number } | undefined;
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
      aimAt: (x: number, y: number, z: number) => void;
    };
  }
}
export {};

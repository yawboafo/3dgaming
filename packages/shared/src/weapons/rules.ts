import { Key } from '../messages.js';
import { pressed } from '../interact/interactables.js';
import type { WeaponSpec } from './spec.js';

/** Per-player weapon state the server keeps (and mirrors the current weapon of into the schema). */
export interface Arsenal {
  current: number;
  mags: number[];
  reserves: number[];
  /** Simulation time (s) when the next shot is allowed. */
  nextShotAt: number;
  /** Simulation time (s) the running reload completes, or 0. */
  reloadDoneAt: number;
}

export function newArsenal(weapons: WeaponSpec[]): Arsenal {
  return {
    current: 0,
    mags: weapons.map((w) => w.magazine),
    reserves: weapons.map((w) => w.reserve),
    nextShotAt: 0,
    reloadDoneAt: 0,
  };
}

const WEAPON_KEYS = [Key.Weapon1, Key.Weapon2];

export interface WeaponStep {
  /** A shot leaves the barrel this step. */
  fired: boolean;
  /** Reload started this step (for the client's animation/sound). */
  reloadStarted: boolean;
}

/**
 * Advance one player's weapon by one input frame at simulation time `now`. Pure: the server runs
 * it authoritatively; the client may run it to predict muzzle flashes and ammo.
 */
export function stepWeapon(
  a: Arsenal,
  weapons: WeaponSpec[],
  keys: number,
  prevKeys: number,
  now: number,
): WeaponStep {
  const out: WeaponStep = { fired: false, reloadStarted: false };

  // Switching cancels a reload and has a short draw delay.
  WEAPON_KEYS.forEach((k, i) => {
    if (i < weapons.length && i !== a.current && pressed(keys, prevKeys, k)) {
      a.current = i;
      a.reloadDoneAt = 0;
      a.nextShotAt = Math.max(a.nextShotAt, now + 0.25);
    }
  });
  const w = weapons[a.current]!;
  const i = a.current;

  if (a.reloadDoneAt && now >= a.reloadDoneAt) {
    const take = Math.min(w.magazine - a.mags[i]!, a.reserves[i]!);
    a.mags[i]! += take;
    a.reserves[i]! -= take;
    a.reloadDoneAt = 0;
  }
  const reloading = a.reloadDoneAt > 0;

  const wantsReload = pressed(keys, prevKeys, Key.Reload) && a.mags[i]! < w.magazine;
  const trigger = w.auto ? (keys & Key.Fire) !== 0 : pressed(keys, prevKeys, Key.Fire);

  if (!reloading && trigger && a.mags[i]! > 0 && now >= a.nextShotAt) {
    a.mags[i]! -= 1;
    a.nextShotAt = now + w.interval;
    out.fired = true;
  } else if (!reloading && a.reserves[i]! > 0 && (wantsReload || (trigger && a.mags[i] === 0))) {
    a.reloadDoneAt = now + w.reload;
    out.reloadStarted = true;
  }
  return out;
}

/** Unit aim vector for the camera yaw/pitch convention (yaw π looks toward +Z, pitch < 0 looks down). */
export function aimDirection(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** Shots start where the camera looks at: the orbit pivot above the feet. */
export const AIM_PIVOT_HEIGHT = 1.6;

/** One integration step of a projectile with gravity; returns the new position (velocity updated in place). */
export function stepProjectile(
  pos: [number, number, number],
  vel: [number, number, number],
  gravity: number,
  dt: number,
): [number, number, number] {
  vel[1] -= gravity * dt;
  return [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt, pos[2] + vel[2] * dt];
}

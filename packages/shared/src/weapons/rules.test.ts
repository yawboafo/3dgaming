import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Key } from '../messages.js';
import { aimDirection, newArsenal, stepProjectile, stepWeapon } from './rules.js';
import type { WeaponCatalog } from './spec.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../../../world/weapons.json', import.meta.url), 'utf8'),
) as WeaponCatalog;
const W = catalog.weapons;
const pistol = W[0]!;
const rifle = W[1]!;
const DT = 0.05;

/** Run frames of held keys from t; returns shots fired and the end time. */
function hold(a: ReturnType<typeof newArsenal>, keys: number, seconds: number, t = 0, prev = 0) {
  let shots = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++, t += DT) {
    if (stepWeapon(a, W, keys, prev, t).fired) shots++;
    prev = keys;
  }
  return { shots, t, prev };
}

describe('weapon rules', () => {
  it('pistol fires once per press, not while held', () => {
    const a = newArsenal(W);
    expect(hold(a, Key.Fire, 2).shots).toBe(1);
    expect(a.mags[0]).toBe(pistol.magazine - 1);
  });

  it('pistol taps respect the fire interval', () => {
    const a = newArsenal(W);
    let shots = 0;
    for (let i = 0; i < 20; i++) {
      // tap every frame: press on even frames, release on odd ones, for one second
      const keys = i % 2 === 0 ? Key.Fire : 0;
      if (stepWeapon(a, W, keys, i % 2 === 0 ? 0 : Key.Fire, i * DT).fired) shots++;
    }
    expect(shots).toBeLessThanOrEqual(Math.ceil(1 / pistol.interval));
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  it('rifle is automatic at its interval and empties the magazine', () => {
    const a = newArsenal(W);
    stepWeapon(a, W, Key.Weapon2, 0, 0);
    const r = hold(a, Key.Fire, 2, 0.3);
    expect(r.shots).toBe(Math.round(2 / Math.max(rifle.interval, DT)) + 0); // one per interval
    expect(a.mags[1]).toBe(rifle.magazine - r.shots);
  });

  it('reloads after the reload time, moving rounds from reserve', () => {
    const a = newArsenal(W);
    a.mags[0] = 3;
    let t = 0;
    expect(stepWeapon(a, W, Key.Reload, 0, t).reloadStarted).toBe(true);
    ({ t } = hold(a, Key.Fire, pistol.reload - 0.1, DT, Key.Reload));
    expect(a.mags[0]).toBe(3); // can't fire or finish early
    hold(a, 0, 0.2, t);
    expect(a.mags[0]).toBe(pistol.magazine);
    expect(a.reserves[0]).toBe(pistol.reserve - (pistol.magazine - 3));
  });

  it('pulling the trigger on an empty magazine starts a reload; no reserve means click', () => {
    const a = newArsenal(W);
    a.mags[0] = 0;
    expect(stepWeapon(a, W, Key.Fire, 0, 0).reloadStarted).toBe(true);
    const b = newArsenal(W);
    b.mags[0] = 0;
    b.reserves[0] = 0;
    const s = stepWeapon(b, W, Key.Fire, 0, 0);
    expect(s.fired || s.reloadStarted).toBe(false);
  });

  it('switching weapons cancels a reload', () => {
    const a = newArsenal(W);
    a.mags[0] = 1;
    stepWeapon(a, W, Key.Reload, 0, 0);
    stepWeapon(a, W, Key.Weapon2, Key.Reload, DT);
    expect(a.current).toBe(1);
    expect(a.reloadDoneAt).toBe(0);
    hold(a, 0, 3, 2 * DT);
    expect(a.mags[0]).toBe(1);
  });
});

describe('aim and ballistics', () => {
  it('aims along the camera: yaw 0 looks -Z, yaw π looks +Z, negative pitch looks down', () => {
    const f = aimDirection(0, 0);
    expect(f[2]).toBeCloseTo(-1);
    expect(aimDirection(Math.PI, 0)[2]).toBeCloseTo(1);
    expect(aimDirection(0, -0.5)[1]).toBeLessThan(0);
    expect(Math.hypot(...aimDirection(1.2, 0.4))).toBeCloseTo(1);
  });

  it('projectiles drop under gravity', () => {
    const vel: [number, number, number] = [0, 0, -100];
    let p: [number, number, number] = [0, 2, 0];
    for (let i = 0; i < 20; i++) p = stepProjectile(p, vel, 4, 1 / 60);
    expect(p[2]).toBeCloseTo((-100 * 20) / 60, 1);
    expect(p[1]).toBeLessThan(2);
  });
});

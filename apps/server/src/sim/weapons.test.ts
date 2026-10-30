import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CharacterMotor,
  GRAVITY,
  Key,
  PLAYER,
  PlayerState,
  TownState,
  addProxy,
  addWorldBounds,
  type ShotEvent,
  type WeaponCatalog,
} from '@town/shared';
import { HitRegistry } from './hits.js';
import { WeaponSystem } from './weapons.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../../../world/weapons.json', import.meta.url), 'utf8'),
) as WeaponCatalog;
const DT = 0.05;

function rig(wall = false) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addWorldBounds(RAPIER, world);
  if (wall) addProxy(RAPIER, world, { type: 'box', pos: [100, 1.5, 95], half: [3, 1.5, 0.2] });
  const motor = new CharacterMotor(RAPIER, world);
  const state = new TownState();
  const hits = new HitRegistry();
  const shots: ShotEvent[] = [];
  const weapons = new WeaponSystem(world, catalog.weapons, state, hits, {
    colliderOf: (sid) => motor.collider(sid),
    broadcast: (e) => shots.push(e),
    killed: () => {},
  });
  const add = (sid: string, x: number, z: number) => {
    const p = new PlayerState();
    Object.assign(p, { x, y: 0, z });
    state.players.set(sid, p);
    motor.add(sid, p);
    weapons.join(sid, p);
    hits.add(motor.collider(sid)!.handle, {
      kind: 'player',
      id: sid,
      damage: (n) => weapons.damagePlayer(sid, n, weapons.now),
    });
    return p;
  };
  world.step();
  const shooter = add('a', 100, 100);
  const target = add('b', 100, 90); // 10 m straight ahead (-Z)
  world.step();
  // Aim from the shooter's pivot at the target's chest.
  const dy = 0.9 - 1.6;
  const pitch = Math.atan2(dy, 10);
  let now = 0;
  const frame = (keys: number) => {
    now += DT;
    weapons.now = now;
    weapons.update('a', shooter, { seq: 1, dt: DT, keys, yaw: 0, pitch }, now);
    weapons.stepProjectiles(DT, now);
    world.step();
  };
  return { shots, target, frame, state, weapons, world, hits };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('server-side hit validation', () => {
  it('a hitscan shot along the aim damages the player it reaches', () => {
    const { shots, target, frame } = rig();
    frame(Key.Fire);
    expect(shots[0]?.hit).toBe('player');
    expect(target.health).toBe(PLAYER.maxHealth - catalog.weapons[0]!.damage);
  });

  it('a wall between shooter and target stops the shot', () => {
    const { shots, target, frame } = rig(true);
    frame(Key.Fire);
    expect(shots[0]?.hit).toBe('world');
    expect(target.health).toBe(PLAYER.maxHealth);
  });

  it('holding the trigger cannot beat the fire rate or the magazine', () => {
    const { shots, frame } = rig();
    // Spam presses every frame for 2 s (press, release, press, …).
    for (let i = 0; i < 40; i++) frame(i % 2 === 0 ? Key.Fire : 0);
    const pistol = catalog.weapons[0]!;
    expect(shots.length).toBeLessThanOrEqual(Math.ceil(2 / pistol.interval));
    expect(shots.length).toBeLessThanOrEqual(pistol.magazine);
  });

  it('kills at zero health, and dead players stop taking damage', () => {
    const { target, frame, shots } = rig();
    // Five pistol shots (25 each): the fifth lands on an already-dead target.
    for (let i = 0; i < 40; i++) frame(i % 8 === 0 ? Key.Fire : 0);
    expect(shots.filter((s) => s.hit === 'player')).toHaveLength(5);
    expect(target.health).toBe(0);
  });

  it('rifle rounds fly for a few ticks before hitting', () => {
    const { shots, target, frame } = rig();
    frame(Key.Weapon2);
    for (let i = 0; i < 6; i++) frame(0); // draw delay
    frame(Key.Fire);
    expect(shots.length).toBe(0); // still in flight after one tick at 140 m/s over 10 m
    for (let i = 0; i < 4; i++) frame(0);
    expect(shots[0]?.hit).toBe('player');
    expect(target.health).toBe(PLAYER.maxHealth - catalog.weapons[1]!.damage);
  });
});

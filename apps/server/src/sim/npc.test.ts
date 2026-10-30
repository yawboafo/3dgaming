import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GRAVITY,
  NpcMood,
  TownState,
  addChunkColliders,
  addWorldBounds,
  type VehicleCatalog,
  type WorldDef,
} from '@town/shared';
import { HitRegistry } from './hits.js';
import { Navmesh } from './navmesh.js';
import { PedestrianSystem } from './pedestrians.js';
import { TrafficSystem } from './traffic.js';

const read = <T>(f: string) =>
  JSON.parse(readFileSync(new URL(`../../../../world/${f}`, import.meta.url), 'utf8')) as T;
const town = read<WorldDef>('town.json');
const catalog = read<VehicleCatalog>('vehicles.json');
const nav = () => new Navmesh(town);
const DT = 0.05;

function world() {
  const w = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addWorldBounds(RAPIER, w);
  for (const c of town.chunks) addChunkColliders(RAPIER, w, c);
  w.step();
  return w;
}

function run(
  w: RAPIER.World,
  systems: { update(dt: number, now: number): void }[],
  seconds: number,
  t0 = 0,
) {
  let now = t0;
  for (let i = 0; i < seconds / DT; i++) {
    now += DT;
    systems.forEach((s) => s.update(DT, now));
    w.timestep = DT;
    w.step();
  }
  return now;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('pedestrians', () => {
  it('stroll the sidewalks', () => {
    const w = world();
    const state = new TownState();
    const peds = new PedestrianSystem(8, town.spawn, w, nav(), state, new HitRegistry());
    const start = [...state.npcs.values()].map((n) => [n.x, n.z]);
    run(w, [peds], 20);
    const moved = [...state.npcs.values()].map((n, i) =>
      Math.hypot(n.x - start[i]![0]!, n.z - start[i]![1]!),
    );
    expect(moved.filter((d) => d > 3).length).toBeGreaterThanOrEqual(6);
  });

  it('flee from gunfire they can hear, ignore what they cannot', () => {
    const w = world();
    const state = new TownState();
    const peds = new PedestrianSystem(12, town.spawn, w, nav(), state, new HitRegistry());
    run(w, [peds], 1);
    const npcs = [...state.npcs.values()];
    const shot: [number, number, number] = [npcs[0]!.x, 1.6, npcs[0]!.z];
    peds.gunshot(shot);
    for (const n of npcs) {
      const d = Math.hypot(n.x - shot[0], n.z - shot[2]);
      if (d < 25) expect(n.mood).toBe(NpcMood.Flee);
      if (d > 35) expect(n.mood).toBe(NpcMood.Walk);
    }
    // Fleeing pedestrians run, and calm down again later.
    run(w, [peds], 2, 1);
    expect(npcs[0]!.speed).toBeGreaterThan(2.5);
    run(w, [peds], 10, 3);
    expect(npcs[0]!.mood).toBe(NpcMood.Walk);
  });

  it('go down when shot to zero, then get back up', () => {
    const w = world();
    const state = new TownState();
    const hits = new HitRegistry();
    const peds = new PedestrianSystem(1, town.spawn, w, nav(), state, hits);
    const npc = state.npcs.get('n.0')!;
    run(w, [peds], 0.5);
    const target = hits.byId('n.0')!;
    target.damage!(60, 'p');
    expect(npc.mood).toBe(NpcMood.Flee);
    target.damage!(60, 'p');
    expect(npc.health).toBe(0);
    expect(npc.mood).toBe(NpcMood.Down);
    run(w, [peds], 16, 0.5);
    expect(npc.health).toBe(100);
    expect(npc.mood).toBe(NpcMood.Walk);
  });
});

describe('traffic', () => {
  it('drives its loops at cruising speed', () => {
    const w = world();
    const state = new TownState();
    const traffic = new TrafficSystem(w, town, catalog, state, new HitRegistry());
    const cars = [...state.vehicles.values()];
    expect(cars).toHaveLength(town.trafficRoutes.length * 2);
    const start = cars.map((c) => [c.x, c.z]);
    run(w, [traffic], 10);
    cars.forEach((c, i) => {
      expect(Math.hypot(c.x - start[i]![0]!, c.z - start[i]![1]!)).toBeGreaterThan(20);
    });
  });

  it('stops for something in the lane, then carries on when it moves', () => {
    const w = world();
    const state = new TownState();
    const traffic = new TrafficSystem(w, town, catalog, state, new HitRegistry());
    const car = state.vehicles.get('t.0')!;
    run(w, [traffic], 1);
    // Drop a pedestrian-sized body on the route, about 12 m (4 waypoints) beyond the car.
    const route = town.trafficRoutes[0]!.points;
    const nearest = route.reduce(
      (best, p, i) =>
        Math.hypot(p[0] - car.x, p[2] - car.z) <
        Math.hypot(route[best]![0] - car.x, route[best]![2] - car.z)
          ? i
          : best,
      0,
    );
    const spot = route[(nearest + 4) % route.length]!;
    const blocker = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spot[0], 1, spot[2]),
    );
    w.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35), blocker);
    run(w, [traffic], 4, 1);
    expect(car.speed).toBeLessThan(0.5);
    const gap = Math.hypot(blocker.translation().x - car.x, blocker.translation().z - car.z);
    expect(gap).toBeGreaterThan(3);
    w.removeRigidBody(blocker);
    run(w, [traffic], 3, 5);
    expect(car.speed).toBeGreaterThan(5);
  });

  it('hurries away from gunfire', () => {
    const w = world();
    const state = new TownState();
    const traffic = new TrafficSystem(w, town, catalog, state, new HitRegistry());
    const car = state.vehicles.get('t.0')!;
    const now = run(w, [traffic], 3);
    const cruise = car.speed;
    traffic.gunshot([car.x, 1, car.z], now);
    run(w, [traffic], 2, now);
    expect(car.speed).toBeGreaterThan(cruise + 2);
  });
});

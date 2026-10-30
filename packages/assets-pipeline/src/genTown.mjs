// Generates world/town.json from world/assets.json + world/asset-bounds.json.
// The output is plain data: hand edits or a Blender-authored layout can replace it entirely.
//   pnpm town:gen [--seed 7]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeNavGrid, trafficLoops } from './genNav.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(join(root, 'world/assets.json'), 'utf8'));
const bounds = JSON.parse(readFileSync(join(root, 'world/asset-bounds.json'), 'utf8'));
const seedArg = process.argv.indexOf('--seed');
const SEED = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 7;

const CHUNK = 64;
const CHUNKS = 7;
const TILE = 8; // one Kenney road tile = 1 unit × scale 8
const TILES = (CHUNK * CHUNKS) / TILE; // 56
const ROAD_EVERY = 8; // one road line per chunk…
const ROAD_OFFSET = 4; // …through the chunk's middle, so every crossing is a full crossroad
/** Kenney suburban fronts face +Z at rotY 0. */
const ALL_HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `house-${c}`);
const MAX_FRONTAGE = 13;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const isRoad = (t) => t % ROAD_EVERY === ROAD_OFFSET;
const round = (v) => Math.round(v * 100) / 100;

const scaleOf = (id) => {
  const s = manifest.assets[id]?.scale ?? 1;
  return Array.isArray(s) ? s : [s, s, s];
};
const boundsOf = (id) => {
  const def = manifest.assets[id];
  const b = def && bounds[def.url];
  if (!b) throw new Error(`No bounds for asset "${id}" — run pnpm assets:build first`);
  return b;
};

/** Only houses that fit a lot: wider models would poke onto the road. */
const HOUSES = ALL_HOUSES.filter((id) => {
  const b = boundsOf(id);
  return (b.max[0] - b.min[0]) * scaleOf(id)[0] <= MAX_FRONTAGE;
});

const chunks = new Map();
const houses = [];
for (let cz = 0; cz < CHUNKS; cz++)
  for (let cx = 0; cx < CHUNKS; cx++)
    chunks.set(`${cx},${cz}`, { cx, cz, props: [], colliders: [] });

function place(asset, x, z, rotY = 0) {
  const chunk = chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
  if (!chunk) return;
  const pos = [round(x), 0, round(z)];
  chunk.props.push({ asset, pos, rotY });
  if (asset.startsWith('house-')) houses.push({ asset, x, z, rotY, chunk });
  const kind = manifest.assets[asset].collider ?? 'box';
  if (kind === 'none') return;
  const b = boundsOf(asset);
  const s = scaleOf(asset);
  // Authored COL_* proxies (from the asset pipeline) win over the generated box.
  const boxes = b.colliders?.length
    ? b.colliders.map((c) => ({
        half: c.half.map((h, i) => h * s[i]),
        lc: c.center.map((v, i) => v * s[i]),
      }))
    : [
        {
          half: [0, 1, 2].map((i) => ((b.max[i] - b.min[i]) * s[i]) / 2),
          lc: [0, 1, 2].map((i) => ((b.max[i] + b.min[i]) * s[i]) / 2),
        },
      ];
  for (const { half, lc } of boxes) {
    if (kind === 'trunk' && !b.colliders?.length) {
      half[0] = half[2] = 0.2;
      lc[0] = lc[2] = 0;
    }
    // Local box centre, rotated into the world by rotY.
    const r = (rotY * Math.PI) / 180;
    const cx = x + lc[0] * Math.cos(r) + lc[2] * Math.sin(r);
    const cz = z - lc[0] * Math.sin(r) + lc[2] * Math.cos(r);
    chunk.colliders.push({
      type: 'box',
      pos: [round(cx), round(lc[1]), round(cz)],
      half: half.map(round),
      rotY,
    });
  }
}

// Roads: a grid of straight tiles with crossroads where lines meet.
for (let tz = 0; tz < TILES; tz++) {
  for (let tx = 0; tx < TILES; tx++) {
    const x = tx * TILE + TILE / 2;
    const z = tz * TILE + TILE / 2;
    if (isRoad(tx) && isRoad(tz)) place('road-crossroad', x, z);
    else if (isRoad(tx)) place('road-straight', x, z, 0);
    else if (isRoad(tz)) place('road-straight', x, z, 90);
  }
}

// Blocks between road lines: houses face the road on each side, greenery in the middle.
const lines = [];
for (let t = 0; t < TILES; t++) if (isRoad(t)) lines.push(t);
const spans = [];
let start = 0;
for (const t of lines) {
  if (t > start) spans.push([start * TILE, t * TILE, start > 0, true]);
  start = t + 1;
}
spans.push([start * TILE, TILES * TILE, true, false]);

const SETBACK = 2.5;
const SLOT = 14;
const DEPTH = 13; // corner allowance on the side streets
for (const [x0, x1, roadW, roadE] of spans) {
  for (const [z0, z1, roadN, roadS] of spans) {
    const w = x1 - x0;
    const d = z1 - z0;
    // North/south faces span the full width.
    const nx = Math.floor(w / SLOT);
    for (let i = 0; i < nx; i++) {
      const x = x0 + (w - nx * SLOT) / 2 + SLOT * (i + 0.5);
      if (roadN) place(pick(HOUSES), x, z0 + SETBACK + 5.5, 180);
      if (roadS) place(pick(HOUSES), x, z1 - SETBACK - 5.5, 0);
    }
    // East/west faces only between the corner houses.
    const inner = d - 2 * DEPTH;
    const nz = Math.max(0, Math.floor(inner / SLOT));
    for (let i = 0; i < nz; i++) {
      const z = z0 + DEPTH + (inner - nz * SLOT) / 2 + SLOT * (i + 0.5);
      if (roadW) place(pick(HOUSES), x0 + SETBACK + 5.5, z, 270);
      if (roadE) place(pick(HOUSES), x1 - SETBACK - 5.5, z, 90);
    }
    // Courtyard greenery.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (w > 30 && d > 30) {
      for (let k = 0; k < 4; k++) {
        place(
          rand() < 0.6 ? 'tree-large' : 'tree-small',
          cx + (rand() - 0.5) * 14,
          cz + (rand() - 0.5) * 14,
          Math.floor(rand() * 4) * 90,
        );
      }
      place('planter', cx, cz, 0);
    }
  }
}

// Street lights on the east/south sidewalk of each road line, every 24 m.
for (const t of lines) {
  const edge = t * TILE + TILE - 0.6;
  for (let p = 12; p < TILES * TILE; p += 24) {
    if (lines.some((l) => p > l * TILE - 2 && p < l * TILE + TILE + 2)) continue;
    place('streetlight', edge, p, 270);
    place('streetlight', p, edge, 180);
  }
}

const centre = lines[Math.floor(lines.length / 2)] * TILE + TILE / 2;

// Enterable buildings: the houses nearest the centre whose fronts face north (-Z) onto a road.
// Interior files live in world/interiors/<id>.json; the door is a trigger just outside the front.
const INTERIORS = [
  { id: 'chop-bar', name: "Auntie Esi's Chop Bar" },
  { id: 'provisions', name: "Kofi's Provisions" },
  { id: 'salon', name: 'Sea View Barbering Salon' },
];
const doorHouses = houses
  .filter((h) => h.rotY === 180)
  .sort((a, b) => Math.hypot(a.x - centre, a.z - centre) - Math.hypot(b.x - centre, b.z - centre))
  .slice(0, INTERIORS.length);
const doors = doorHouses.map((h, i) => {
  const front = boundsOf(h.asset).max[2] * scaleOf(h.asset)[2];
  const r = (h.rotY * Math.PI) / 180;
  const [fx, fz] = [Math.sin(r), Math.cos(r)]; // local +Z (the front) in world space
  const at = (d) => [round(h.x + fx * (front + d)), 0, round(h.z + fz * (front + d))];
  const { id, name } = INTERIORS[i];
  const door = {
    id: `${id}-door`,
    pos: at(0.6),
    range: 2.5,
    prompt: `Enter ${name}`,
    action: { type: 'enter', interior: id, exitPos: at(2.2), exitYaw: round(Math.atan2(-fx, -fz)) },
  };
  (h.chunk.interactables ??= []).push(door);
  return door;
});

// Vehicles parked on the road in front of the first doors (the sedan right by the spawn).
const [sx, , sz] = doors[0].action.exitPos;
const kerbZ = round(sz - 3.9); // the lane nearest the houses
const vehicles = [
  { kind: 'sedan', pos: [sx, 0.3, kerbZ], rotY: 90 },
  { kind: 'motorbike', pos: [round(sx - 9), 0.3, round(kerbZ + 0.3)], rotY: 270 }, // facing away from the sedan
  { kind: 'taxi', pos: [round(sx + 22), 0.3, round(kerbZ - 2.6)], rotY: 270 }, // oncoming lane (drive on the right)
];

// Destructible props (world/weapons.json kinds) near the spawn, sized from their model bounds.
const weapons = JSON.parse(readFileSync(join(root, 'world/weapons.json'), 'utf8'));
const destructibles = [];
const propSpot = (kind, x, z, rotY) => {
  const def = weapons.props[kind];
  const b = bounds[manifest.assets[def.asset].url];
  const s = def.scale;
  const lift = round(-b.min[1] * s); // sit on the ground
  destructibles.push({
    kind,
    pos: [round(x), lift, round(z)],
    rotY,
    half: [0, 1, 2].map((i) => round(((b.max[i] - b.min[i]) * s) / 2)),
    center: [0, 1, 2].map((i) => round(((b.max[i] + b.min[i]) * s) / 2)),
  });
};
// A row of crates and targets on the far pavement, across the road from the spawn.
const rowZ = round(sz - 9.4);
['crate', 'crate-small', 'target', 'crate', 'target', 'crate-small'].forEach((k, i) =>
  propSpot(k, sx - 10 + i * 4, rowZ, k === 'target' ? 0 : 90),
);
// And a stack by the bike.
propSpot('crate', sx - 13, round(sz + 0.5), 0);
propSpot('crate-small', sx - 13, round(sz + 2.2), 0);

const roadCentres = lines.map((t) => t * TILE + TILE / 2);
const { navGrid, cells: navCells } = bakeNavGrid({
  roadCentres,
  tile: TILE,
  worldSize: TILES * TILE,
  solids: [...chunks.values()]
    .flatMap((c) => c.colliders)
    .concat(destructibles.map((d) => ({ pos: d.pos, half: d.half, rotY: d.rotY }))),
});
const trafficRoutes = trafficLoops(roadCentres);

const world = {
  version: 1,
  chunkSize: CHUNK,
  terrain: { type: 'flat', height: 0 },
  // Spawn outside the first door, facing away from it.
  spawn: doors[0].action.exitPos,
  spawnYaw: doors[0].action.exitYaw,
  vehicles,
  destructibles,
  navGrid,
  trafficRoutes,
  interiors: INTERIORS.map((d) => d.id),
  chunks: [...chunks.values()],
};
writeFileSync(join(root, 'world/town.json'), JSON.stringify(world));
const props = world.chunks.reduce((a, c) => a + c.props.length, 0);
const cols = world.chunks.reduce((a, c) => a + c.colliders.length, 0);
console.log(
  `[town] seed ${SEED}: ${world.chunks.length} chunks, ${props} props, ${cols} colliders → world/town.json`,
);
for (const d of doors) console.log(`[town]   door ${d.id} at ${d.pos.join(',')}`);
console.log(
  `[town]   navmesh ${navCells} walkable cells, ${trafficRoutes.length} traffic loops (${trafficRoutes.map((r) => r.points.length).join('/')} waypoints)`,
);

import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD_SIZE } from '../chunks.js';
import type { ChunkDef, CollisionProxy, InteriorDef } from '../world.js';

type Rapier = typeof RAPIER;

const yawQuat = (deg = 0) => {
  const r = (deg * Math.PI) / 360;
  return { x: 0, y: Math.sin(r), z: 0, w: Math.cos(r) };
};

/** Ground slab plus invisible walls so nothing leaves the town. */
export function addWorldBounds(R: Rapier, world: RAPIER.World): RAPIER.Collider[] {
  const half = WORLD_SIZE / 2;
  const wall = 10;
  return [
    R.ColliderDesc.cuboid(half + wall, 0.5, half + wall).setTranslation(half, -0.5, half),
    R.ColliderDesc.cuboid(0.5, wall, half).setTranslation(-0.5, wall, half),
    R.ColliderDesc.cuboid(0.5, wall, half).setTranslation(WORLD_SIZE + 0.5, wall, half),
    R.ColliderDesc.cuboid(half, wall, 0.5).setTranslation(half, wall, -0.5),
    R.ColliderDesc.cuboid(half, wall, 0.5).setTranslation(half, wall, WORLD_SIZE + 0.5),
  ].map((d) => world.createCollider(d));
}

export function addProxy(
  R: Rapier,
  world: RAPIER.World,
  p: CollisionProxy,
): RAPIER.Collider | undefined {
  // Mesh proxies need the asset's triangles; boxes cover every Phase 0 placeholder.
  if (p.type !== 'box') return undefined;
  const desc = R.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2])
    .setTranslation(p.pos[0], p.pos[1], p.pos[2])
    .setRotation(yawQuat(p.rotY));
  return world.createCollider(desc);
}

export function addChunkColliders(
  R: Rapier,
  world: RAPIER.World,
  chunk: ChunkDef,
): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  for (const p of chunk.colliders) {
    const c = addProxy(R, world, p);
    if (c) out.push(c);
  }
  return out;
}

/** An interior's solid boxes, offset to its origin. */
export function addInteriorColliders(
  R: Rapier,
  world: RAPIER.World,
  interior: InteriorDef,
): RAPIER.Collider[] {
  const [ox, oy, oz] = interior.origin;
  const out: RAPIER.Collider[] = [];
  for (const b of interior.boxes) {
    if (b.collide === false) continue;
    const c = addProxy(R, world, {
      type: 'box',
      pos: [b.pos[0] + ox, b.pos[1] + oy, b.pos[2] + oz],
      half: b.half,
    });
    if (c) out.push(c);
  }
  return out;
}

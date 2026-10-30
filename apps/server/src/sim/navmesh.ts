import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { Pathfinding } from 'three-pathfinding';
import type { WorldDef } from '@town/shared';

const ZONE = 'town';

/**
 * Pedestrian navmesh baked at startup from town.json's walkable bitmap (2 m cells): an indexed grid
 * mesh (shared vertices, so three-pathfinding links neighbouring cells) → Pathfinding.createZone.
 */
export class Navmesh {
  private readonly pf = new Pathfinding();
  /** The connected island most pedestrians live on. */
  readonly group: number;
  readonly polygons: number;

  constructor(town: WorldDef) {
    const { cell, size, bits } = town.navGrid;
    const raw = Buffer.from(bits, 'base64');
    const walk = (i: number, j: number) => {
      const k = j * size + i;
      return (raw[k >> 3]! & (1 << (k & 7))) !== 0;
    };
    const vid = (i: number, j: number) => j * (size + 1) + i;
    const pos = new Float32Array((size + 1) * (size + 1) * 3);
    for (let j = 0; j <= size; j++)
      for (let i = 0; i <= size; i++) pos.set([i * cell, 0, j * cell], vid(i, j) * 3);
    const index: number[] = [];
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        if (!walk(i, j)) continue;
        // Counter-clockwise seen from above (+Y normal).
        index.push(
          vid(i, j),
          vid(i, j + 1),
          vid(i + 1, j),
          vid(i + 1, j),
          vid(i, j + 1),
          vid(i + 1, j + 1),
        );
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(index);
    const zone = Pathfinding.createZone(geo);
    this.pf.setZoneData(ZONE, zone);
    this.polygons = index.length / 3;
    // Largest group = the main sidewalk network (cut-outs around props can make small islands).
    const groups = (zone as unknown as { groups: unknown[][] }).groups;
    this.group = groups.reduce((best, g, i) => (g.length > groups[best]!.length ? i : best), 0);
  }

  /** A random walkable point within `range` of `near` (falls back to anywhere on the network). */
  randomPoint(near: [number, number, number], range: number): [number, number, number] {
    // Despite its typings, getRandomNode returns the chosen polygon's centroid (a Vector3), or an
    // empty Vector3 when nothing is in range.
    const c = this.pf.getRandomNode(
      ZONE,
      this.group,
      new Vector3(...near),
      range,
    ) as unknown as Vector3;
    return c && (c.x !== 0 || c.z !== 0) ? [c.x, 0, c.z] : near;
  }

  /** Path from `a` to `b` along the sidewalks (excluding `a`), or [] if unreachable. */
  path(a: [number, number, number], b: [number, number, number]): [number, number, number][] {
    const p = this.pf.findPath(new Vector3(...a), new Vector3(...b), ZONE, this.group);
    return (p ?? []).map((v) => [v.x, 0, v.z]);
  }
}

import RAPIER from '@dimforge/rapier3d-compat';
import { PropState, type TownState, type WeaponCatalog, type WorldDef } from '@town/shared';
import type { HitRegistry } from './hits.js';

/** Destructible props: fixed colliders with health, removed from physics and state at zero. */
export class PropSystem {
  constructor(
    world: RAPIER.World,
    town: WorldDef,
    catalog: WeaponCatalog,
    state: TownState,
    hits: HitRegistry,
  ) {
    town.destructibles.forEach((d, i) => {
      const spec = catalog.props[d.kind];
      if (!spec) throw new Error(`Unknown destructible "${d.kind}"`);
      const id = `d.${i}`;
      const r = (d.rotY * Math.PI) / 180;
      const [cx, cy, cz] = d.center;
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(...d.half)
          .setTranslation(
            d.pos[0] + cx * Math.cos(r) + cz * Math.sin(r),
            d.pos[1] + cy,
            d.pos[2] - cx * Math.sin(r) + cz * Math.cos(r),
          )
          .setRotation({ x: 0, y: Math.sin(r / 2), z: 0, w: Math.cos(r / 2) }),
      );
      const ps = new PropState();
      ps.kind = d.kind;
      ps.health = spec.health;
      state.props.set(id, ps);
      hits.add(collider.handle, {
        kind: 'prop',
        id,
        damage: (amount) => {
          ps.health = Math.max(0, ps.health - amount);
          if (ps.health > 0) return;
          hits.remove(collider.handle);
          world.removeCollider(collider, false);
          state.props.delete(id);
        },
      });
    });
  }
}

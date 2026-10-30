import * as THREE from 'three';
import type { Room } from '@colyseus/sdk';
import { Callbacks } from '@colyseus/sdk';
import {
  ServerMsg,
  type ShotEvent,
  type TownState,
  type WeaponCatalog,
  type WorldDef,
} from '@town/shared';
import type { AssetLoader } from '../assets/loader.js';
import { ShotFx } from '../fx/shotFx.js';
import { CombatHud } from '../hud/combatHud.js';
import type { ClientPhysics } from '../physics/clientPhysics.js';
import { Combat } from './combat.js';
import type { OrbitCamera } from './orbitCamera.js';
import type { PlayerViews } from './players.js';
import { PropViews } from './propViews.js';

/** Gun models for PlayerViews, in weapons.json order. Loaded before any character is built. */
export async function loadGunTemplates(catalog: WeaponCatalog, loader: AssetLoader) {
  return Promise.all(
    catalog.weapons.map(async (w) => ({
      model: (await loader.load(w.model.asset)).scene,
      spec: w.model,
    })),
  );
}

/** Wire shooting: local prediction, server shot events, projectiles and destructible props. */
export async function setupCombat(o: {
  room: Room<unknown, TownState>;
  scene: THREE.Scene;
  town: WorldDef;
  catalog: WeaponCatalog;
  loader: AssetLoader;
  views: PlayerViews;
  physics: ClientPhysics;
  orbit: OrbitCamera;
}) {
  const fx = new ShotFx(o.scene);
  const hud = new CombatHud();
  const props = new PropViews(o.scene, fx);
  await props.load(o.town, o.catalog, o.loader);
  const combat = new Combat(
    o.room.sessionId,
    o.catalog.weapons,
    o.views,
    o.physics,
    o.orbit,
    fx,
    hud,
  );

  const cb = Callbacks.get(o.room);
  cb.onAdd('projectiles', (p, id) => {
    combat.projectileChanged(id, p);
    cb.onChange(p, () => combat.projectileChanged(id, p));
  });
  cb.onRemove('projectiles', (_p, id) => combat.projectileRemoved(id));
  cb.onAdd('props', (p, id) => cb.onChange(p, () => props.damaged(id)));
  cb.onRemove('props', (_p, id) => props.destroyed(id));
  o.room.onMessage(ServerMsg.Shot, (e: ShotEvent) => combat.onShot(e));

  const render = (dt: number) => {
    combat.render(dt);
    props.render();
    const me = o.room.state.players.get(o.room.sessionId);
    const a = combat.ammo;
    hud.update({
      health: me?.health ?? 0,
      weapon: o.catalog.weapons[a.weapon]?.label ?? '',
      mag: a.mag,
      reserve: a.reserve,
      reloading: a.reloading,
      armed: !!me && !me.vehicle,
    });
  };
  const dispose = () => {
    fx.dispose();
    hud.dispose();
    props.dispose();
  };
  return { combat, props, render, dispose };
}

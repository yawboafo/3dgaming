import * as THREE from 'three';
import {
  TOWN_SPACE,
  addInteriorInteractables,
  addTownInteractables,
  createInteractionWorld,
  nearestInteractable,
  removeInteractables,
  updateInteractable,
  addInteractable,
  type InteriorDef,
  type VehicleSpec,
  type WorldDef,
} from '@town/shared';
import { fetchJson } from '../assets/loader.js';
import type { PromptHud } from '../hud/prompt.js';
import type { ClientPhysics } from '../physics/clientPhysics.js';
import { buildInterior, disposeInterior } from '../world/interiorScene.js';

interface LoadedInterior {
  def: InteriorDef;
  group: THREE.Group;
  eids: number[];
}

export interface SpaceHooks {
  scene: THREE.Scene;
  town: THREE.Object3D;
  physics: ClientPhysics;
  hud: PromptHud;
  setIndoors(indoors: boolean): void;
  /** Point the camera the way the server faced the player after a door. */
  faceYaw(yaw: number): void;
}

/**
 * Follows the server's `space` for the local player: the town, or an interior loaded on demand
 * (fetched, built, collided) and dropped again on the way out. Also answers "which prompt now?"
 * from the same bitecs Interactable data the server uses to act.
 */
export class Spaces {
  current = TOWN_SPACE;
  private readonly ecs = createInteractionWorld();
  private readonly defs = new Map<string, Promise<InteriorDef>>();
  private interior?: LoadedInterior;
  private switching = false;
  private readonly vehicleEids = new Map<string, number>();
  private readonly tmp = new THREE.Vector3();
  lastSwitchMs = 0;

  constructor(
    town: WorldDef,
    private readonly hooks: SpaceHooks,
  ) {
    addTownInteractables(this.ecs, town);
  }

  get busy(): boolean {
    return this.switching;
  }

  /** Call every frame with the local player's authoritative space and yaw. */
  sync(space: string, yaw: number): void {
    if (space === this.current || this.switching) return;
    this.switching = true;
    const t0 = performance.now();
    void this.hooks.hud
      .transition(async () => {
        this.unloadInterior();
        if (space !== TOWN_SPACE) await this.loadInterior(space);
        this.hooks.setIndoors(space !== TOWN_SPACE);
        this.hooks.town.visible = space === TOWN_SPACE;
        this.hooks.faceYaw(yaw);
        this.current = space;
      })
      .finally(() => {
        this.lastSwitchMs = performance.now() - t0;
        this.switching = false;
      });
  }

  prompt(x: number, y: number, z: number, riding: boolean): string | undefined {
    if (this.switching) return undefined;
    if (riding) return 'Get out';
    return nearestInteractable(this.ecs, this.current, x, y, z)?.def.prompt;
  }

  /** Vehicles move, so their interactables are refreshed from the views every frame. */
  syncVehicles(
    vehicles: Iterable<[string, { root: THREE.Object3D; driver: string; spec: VehicleSpec }]>,
  ): void {
    for (const [id, v] of vehicles) {
      let eid = this.vehicleEids.get(id);
      if (eid === undefined) {
        eid = addInteractable(
          this.ecs,
          {
            id,
            pos: [0, 0, 0],
            range: v.spec.interactRange,
            prompt: `${v.spec.label === 'Motorbike' ? 'Ride' : 'Drive'} ${v.spec.label}`,
            action: { type: 'vehicle', vehicle: id },
          },
          TOWN_SPACE,
        );
        this.vehicleEids.set(id, eid);
      }
      const p = v.root.getWorldPosition(this.tmp);
      updateInteractable(this.ecs, eid, p.x, p.y, p.z, !v.driver);
    }
  }

  private def(id: string): Promise<InteriorDef> {
    let p = this.defs.get(id);
    if (!p) {
      p = fetchJson<InteriorDef>(`/world/interiors/${id}.json`);
      this.defs.set(id, p);
    }
    return p;
  }

  private async loadInterior(id: string): Promise<void> {
    const def = await this.def(id);
    const group = buildInterior(def);
    this.hooks.scene.add(group);
    this.hooks.physics.addInterior(def);
    this.interior = { def, group, eids: addInteriorInteractables(this.ecs, def) };
  }

  private unloadInterior(): void {
    const i = this.interior;
    if (!i) return;
    this.hooks.scene.remove(i.group);
    disposeInterior(i.group);
    this.hooks.physics.removeInterior(i.def.id);
    removeInteractables(this.ecs, i.eids);
    this.interior = undefined;
  }
}

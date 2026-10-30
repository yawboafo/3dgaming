import * as THREE from 'three';
import { NpcMood, lerp, lerpAngle, type NpcState } from '@town/shared';
import { CharacterView, type CharacterTemplate } from './characterView.js';

interface View {
  character: CharacterView;
  target: { x: number; z: number; yaw: number; speed: number; mood: number };
}

const SMOOTH_PER_SECOND = 10;
/** Pedestrians further than this from the camera focus aren't drawn or animated. */
const DRAW_DISTANCE = 90;

/**
 * Cosmetic pedestrians: one animated character per server NPC, smoothed toward its pose. No
 * shadows and a draw distance keep twenty of them inside the draw-call budget.
 */
export class NpcViews {
  private readonly views = new Map<string, View>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly templates: Record<string, CharacterTemplate>,
    private readonly fallback: CharacterTemplate,
  ) {}

  upsert(id: string, s: NpcState): void {
    let v = this.views.get(id);
    if (!v) {
      const character = new CharacterView(this.templates[s.kind] ?? this.fallback, {
        details: false,
      });
      character.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = false;
      });
      character.root.position.set(s.x, s.y, s.z);
      character.root.rotation.y = s.yaw;
      this.scene.add(character.root);
      v = { character, target: { x: s.x, z: s.z, yaw: s.yaw, speed: s.speed, mood: s.mood } };
      this.views.set(id, v);
    }
    Object.assign(v.target, { x: s.x, z: s.z, yaw: s.yaw, speed: s.speed, mood: s.mood });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.character.root.removeFromParent();
    v.character.dispose();
    this.views.delete(id);
  }

  /** `pose` supplies interpolated positions (x, z); without it positions are smoothed here. */
  render(
    dt: number,
    focus: THREE.Vector3,
    visible: boolean,
    pose?: (id: string) => [number, number] | undefined,
  ): void {
    const k = 1 - Math.exp(-SMOOTH_PER_SECOND * dt);
    for (const [id, v] of this.views) {
      const at = pose?.(id);
      if (at) {
        v.target.x = at[0];
        v.target.z = at[1];
      }
      const p = v.character.root.position;
      const near = Math.hypot(v.target.x - focus.x, v.target.z - focus.z) < DRAW_DISTANCE;
      v.character.root.visible = visible && near;
      if (!v.character.root.visible) {
        p.set(v.target.x, 0, v.target.z);
        continue;
      }
      // Big jumps are respawns: snap.
      if (at || Math.hypot(p.x - v.target.x, p.z - v.target.z) > 8)
        p.set(v.target.x, 0, v.target.z);
      else p.set(lerp(p.x, v.target.x, k), 0, lerp(p.z, v.target.z, k));
      v.character.root.rotation.y = lerpAngle(v.character.root.rotation.y, v.target.yaw, k);
      v.character.update(dt, v.target.speed, false, { dead: v.target.mood === NpcMood.Down });
    }
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  /** Diagnostics: counts by mood among NPCs currently drawn. */
  summary(): { drawn: number; fleeing: number; down: number } {
    let drawn = 0;
    let fleeing = 0;
    let down = 0;
    for (const v of this.views.values()) {
      if (!v.character.root.visible) continue;
      drawn++;
      if (v.target.mood === NpcMood.Flee) fleeing++;
      if (v.target.mood === NpcMood.Down) down++;
    }
    return { drawn, fleeing, down };
  }
}

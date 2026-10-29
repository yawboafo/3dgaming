import * as THREE from 'three';
import { SERVER_DT, lerp, lerpAngle, type PlayerState } from '@town/shared';
import { CharacterView, type CharacterTemplate } from './characterView.js';

interface View {
  character: CharacterView;
  target: { x: number; y: number; z: number; yaw: number; vy: number };
  /** Horizontal speed implied by the last two server states (cosmetic: drives animation). */
  speed: number;
  /** Seconds since the last server change; an unchanged player is standing still. */
  age: number;
}

const SMOOTH_PER_SECOND = 12;

/**
 * Cosmetic player views. Everyone renders from server state with exponential smoothing; deliverable 7
 * replaces this with prediction (local player) and 100 ms interpolation (remote players).
 */
export class PlayerViews {
  private views = new Map<string, View>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly template: CharacterTemplate,
  ) {}

  upsert(id: string, s: PlayerState): void {
    let v = this.views.get(id);
    if (!v) {
      const character = new CharacterView(this.template);
      character.root.position.set(s.x, s.y, s.z);
      this.scene.add(character.root);
      v = { character, target: { x: s.x, y: s.y, z: s.z, yaw: s.yaw, vy: s.vy }, speed: 0, age: 0 };
      this.views.set(id, v);
    }
    const moved = Math.hypot(s.x - v.target.x, s.z - v.target.z);
    v.speed = lerp(v.speed, moved / SERVER_DT, 0.5);
    v.age = 0;
    Object.assign(v.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, vy: s.vy });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.character.root);
    v.character.dispose();
    this.views.delete(id);
  }

  render(dt: number): void {
    const k = 1 - Math.exp(-SMOOTH_PER_SECOND * dt);
    for (const v of this.views.values()) {
      v.age += dt;
      if (v.age > SERVER_DT * 2.5) v.speed = 0;
      const p = v.character.root.position;
      p.set(lerp(p.x, v.target.x, k), lerp(p.y, v.target.y, k), lerp(p.z, v.target.z, k));
      // Server yaw points the way the capsule moves; the model faces +Z, so add π.
      const r = v.character.root.rotation;
      r.y = lerpAngle(r.y, v.target.yaw + Math.PI, k);
      v.character.update(dt, v.speed, Math.abs(v.target.vy) > 0.5 || v.target.y > 0.15);
    }
  }

  get size(): number {
    return this.views.size;
  }

  get(id: string): THREE.Object3D | undefined {
    return this.views.get(id)?.character.root;
  }

  locomotion(id: string): string | undefined {
    return this.views.get(id)?.character.locomotion;
  }
}

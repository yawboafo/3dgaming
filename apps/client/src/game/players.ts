import * as THREE from 'three';
import { SERVER_DT, clamp, lerp, lerpAngle, type PlayerState } from '@town/shared';
import { CharacterView, type CharacterTemplate } from './characterView.js';

interface View {
  character: CharacterView;
  target: { x: number; y: number; z: number; yaw: number; vy: number };
  space: string;
  /** Vehicle id while riding; the character is parented to that vehicle's seat. */
  vehicle: string;
  /** Horizontal speed implied by the last two server states (cosmetic: drives animation). */
  speed: number;
  /** Wall time (s) of the last server change; a player unchanged for a while is standing still. */
  lastUpdate: number;
}

const SMOOTH_PER_SECOND = 12;
const TELEPORT_DISTANCE = 8;
const IDLE_AFTER_S = 0.3;

/**
 * Cosmetic player views. Everyone renders from server state with exponential smoothing; deliverable 7
 * replaces this with prediction (local player) and 100 ms interpolation (remote players).
 */
export class PlayerViews {
  private views = new Map<string, View>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly template: CharacterTemplate,
    private readonly seatOf: (vehicleId: string) => THREE.Object3D | undefined,
  ) {}

  private setVehicle(v: View, vehicle: string): void {
    if (v.vehicle === vehicle) return;
    const root = v.character.root;
    const seat = vehicle ? this.seatOf(vehicle) : undefined;
    if (vehicle && seat) {
      seat.add(root);
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
    } else {
      // Back on foot: return to the scene where the server put us.
      this.scene.add(root);
      root.position.set(v.target.x, v.target.y, v.target.z);
      root.rotation.set(0, v.target.yaw + Math.PI, 0);
    }
    v.vehicle = vehicle && seat ? vehicle : '';
    v.speed = 0;
  }

  upsert(id: string, s: PlayerState): void {
    let v = this.views.get(id);
    if (!v) {
      const character = new CharacterView(this.template);
      character.root.position.set(s.x, s.y, s.z);
      this.scene.add(character.root);
      v = {
        character,
        target: { x: s.x, y: s.y, z: s.z, yaw: s.yaw, vy: s.vy },
        space: s.space,
        vehicle: '',
        speed: 0,
        lastUpdate: performance.now() / 1000,
      };
      this.views.set(id, v);
    }
    const now = performance.now() / 1000;
    const moved = Math.hypot(s.x - v.target.x, s.z - v.target.z);
    v.space = s.space;
    this.setVehicle(v, s.vehicle);
    if (!v.vehicle && moved > TELEPORT_DISTANCE) {
      // Doors teleport: snap instead of sliding across the map.
      v.character.root.position.set(s.x, s.y, s.z);
      v.character.root.rotation.y = s.yaw + Math.PI;
      v.speed = 0;
    } else {
      // Patches can arrive in bursts when frames are slow, so divide by real elapsed time.
      const elapsed = clamp(now - v.lastUpdate, SERVER_DT, 0.5);
      v.speed = lerp(v.speed, moved / elapsed, 0.5);
    }
    v.lastUpdate = now;
    Object.assign(v.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, vy: s.vy });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.character.root.removeFromParent();
    v.character.dispose();
    this.views.delete(id);
  }

  /** Only players in the viewer's space are drawn (cosmetic; interest management is server-side). */
  render(dt: number, viewerSpace: string): void {
    const k = 1 - Math.exp(-SMOOTH_PER_SECOND * dt);
    for (const v of this.views.values()) {
      v.character.root.visible = v.space === viewerSpace;
      if (v.vehicle) {
        v.character.update(dt, 0, false, true);
        continue;
      }
      if (performance.now() / 1000 - v.lastUpdate > IDLE_AFTER_S) v.speed = 0;
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

  vehicleOf(id: string): string {
    return this.views.get(id)?.vehicle ?? '';
  }

  locomotion(id: string): string | undefined {
    return this.views.get(id)?.character.locomotion;
  }
}

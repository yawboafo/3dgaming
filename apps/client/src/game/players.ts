import * as THREE from 'three';
import { SERVER_DT, clamp, lerp, lerpAngle, type PlayerState } from '@town/shared';
import { CharacterView, type CharacterTemplate } from './characterView.js';
import { attachGun, type GunTemplate } from './gunAttach.js';

interface View {
  character: CharacterView;
  target: { x: number; y: number; z: number; yaw: number; vy: number };
  space: string;
  /** Vehicle id while riding; the character is parented to that vehicle's seat. */
  vehicle: string;
  health: number;
  /** One gun model per weapon, parented to the right hand; the current one is shown. */
  guns: THREE.Object3D[];
  weapon: number;
  /** Wall time (s) of this player's last shot, for the aim pose. */
  firedAt: number;
  /** Horizontal speed implied by the last two server states (cosmetic: drives animation). */
  speed: number;
  /** Wall time (s) of the last server change; a player unchanged for a while is standing still. */
  lastUpdate: number;
}

const SMOOTH_PER_SECOND = 12;
const TELEPORT_DISTANCE = 8;
const IDLE_AFTER_S = 0.3;
const AIM_HOLD_S = 1.5;

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
    private readonly gunTemplates: GunTemplate[] = [],
  ) {}

  private makeGuns(c: CharacterView): THREE.Object3D[] {
    const hand = c.hand;
    if (!hand || !(hand as THREE.Bone).isBone) return [];
    return this.gunTemplates.map((t) => {
      const g = attachGun(c.root, hand as THREE.Bone, t);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      g.visible = false;
      return g;
    });
  }

  /** World position of a player's current muzzle (approximate: the gun's origin). */
  muzzle(id: string, out: THREE.Vector3): THREE.Vector3 | undefined {
    const v = this.views.get(id);
    const g = v?.guns[v.weapon];
    return g?.visible
      ? g.getWorldPosition(out)
      : v?.character.root.getWorldPosition(out).setY(out.y + 1.4);
  }

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
        health: s.health,
        guns: this.makeGuns(character),
        weapon: s.weapon,
        firedAt: -Infinity,
        speed: 0,
        lastUpdate: performance.now() / 1000,
      };
      this.views.set(id, v);
    }
    const now = performance.now() / 1000;
    const moved = Math.hypot(s.x - v.target.x, s.z - v.target.z);
    v.space = s.space;
    v.health = s.health;
    v.weapon = s.weapon;
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
      v.guns.forEach((g, i) => (g.visible = i === v.weapon && !v.vehicle && v.health > 0));
      if (v.vehicle) {
        v.character.update(dt, 0, false, { riding: true });
        continue;
      }
      if (v.health === 0) {
        v.character.update(dt, 0, false, { dead: true });
        continue;
      }
      if (performance.now() / 1000 - v.lastUpdate > IDLE_AFTER_S) v.speed = 0;
      const p = v.character.root.position;
      p.set(lerp(p.x, v.target.x, k), lerp(p.y, v.target.y, k), lerp(p.z, v.target.z, k));
      // Server yaw points the way the capsule moves; the model faces +Z, so add π.
      const r = v.character.root.rotation;
      r.y = lerpAngle(r.y, v.target.yaw + Math.PI, k);
      v.character.update(dt, v.speed, Math.abs(v.target.vy) > 0.5 || v.target.y > 0.15, {
        armed: v.guns.length > 0,
        aiming: performance.now() / 1000 - v.firedAt < AIM_HOLD_S,
      });
    }
  }

  get size(): number {
    return this.views.size;
  }

  get(id: string): THREE.Object3D | undefined {
    return this.views.get(id)?.character.root;
  }

  /** Diagnostics: barrel direction of a player's current gun vs the way their body faces. */
  gunCheck(id: string): { barrel: number[]; facing: number[]; up: number[] } | undefined {
    const v = this.views.get(id);
    const g = v?.guns[v.weapon];
    if (!v || !g) return undefined;
    const q = g.getWorldQuaternion(new THREE.Quaternion());
    const z = this.gunTemplates[v.weapon]?.spec.barrel === '+z' ? 1 : -1;
    const barrel = new THREE.Vector3(0, 0, z).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(
      v.character.root.getWorldQuaternion(new THREE.Quaternion()),
    );
    const r = (a: THREE.Vector3) => a.toArray().map((n) => +n.toFixed(2));
    // Rotation (gun-local, degrees XYZ) that would make the barrel follow the body and the top face up.
    const zAxis = facing.clone().multiplyScalar(z); // barrel = z·(local Z) must follow the body
    const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
    const want = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3().crossVectors(zAxis, xAxis), zAxis),
    );
    const fix = new THREE.Euler().setFromQuaternion(q.clone().invert().multiply(want));
    const ws = g.getWorldScale(new THREE.Vector3());
    const wp = g.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(g);
    return {
      visible: g.visible,
      worldScale: r(ws),
      pos: r(wp),
      size: r(box.getSize(new THREE.Vector3())),
      barrel: r(barrel),
      facing: r(facing),
      up: r(up),
      fixDeg: [fix.x, fix.y, fix.z].map((a) => Math.round(THREE.MathUtils.radToDeg(a))),
    } as never;
  }

  /** Someone fired: hold their aim pose for a moment. */
  noteShot(id: string): void {
    const v = this.views.get(id);
    if (v) v.firedAt = performance.now() / 1000;
  }

  vehicleOf(id: string): string {
    return this.views.get(id)?.vehicle ?? '';
  }

  locomotion(id: string): string | undefined {
    return this.views.get(id)?.character.locomotion;
  }
}

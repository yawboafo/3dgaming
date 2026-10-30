import * as THREE from 'three';
import {
  AIM_PIVOT_HEIGHT,
  aimDirection,
  newArsenal,
  stepProjectile,
  stepWeapon,
  type PlayerState,
  type ProjectileState,
  type ShotEvent,
  type WeaponSpec,
} from '@town/shared';
import type { ShotFx } from '../fx/shotFx.js';
import type { CombatHud } from '../hud/combatHud.js';
import type { ClientPhysics } from '../physics/clientPhysics.js';
import type { OrbitCamera } from './orbitCamera.js';
import type { PlayerViews } from './players.js';

type V3 = [number, number, number];

interface Round {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dieAt: number;
  gravity: number;
  /** Server rounds: last synced time, for extrapolation. */
  syncedAt?: number;
}

/**
 * Client side of shooting. The local player's shots are predicted with the same shared rules the
 * server runs (fire rate, ammo, aim), so the muzzle flash, tracer, decal and recoil are instant;
 * the server's ShotEvents then supply hit markers and everyone else's shots. Damage is never
 * applied here.
 */
export class Combat {
  private readonly arsenal;
  private prevKeys = 0;
  private time = 0;
  private readonly local: Round[] = [];
  private readonly remote = new Map<string, Round>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  shotsFired = 0;
  lastHit = '';

  constructor(
    private readonly me: string,
    private readonly weapons: WeaponSpec[],
    private readonly views: PlayerViews,
    private readonly physics: ClientPhysics,
    private readonly orbit: OrbitCamera,
    private readonly fx: ShotFx,
    private readonly hud: CombatHud,
  ) {
    this.arsenal = newArsenal(weapons);
  }

  /** Each input step, with the keys and aim being sent to the server. */
  step(keys: number, dt: number, state: PlayerState | undefined): void {
    this.time += dt;
    const prev = this.prevKeys;
    this.prevKeys = keys;
    if (!state || state.health === 0 || state.vehicle) return;
    const s = stepWeapon(this.arsenal, this.weapons, keys, prev, this.time);
    if (!s.fired) return;
    this.shotsFired++;
    this.views.noteShot(this.me);
    this.predictShot(this.weapons[this.arsenal.current]!);
  }

  /** The server is authoritative for ammo: adopt its numbers whenever they disagree. */
  reconcile(p: PlayerState): void {
    const a = this.arsenal;
    if (a.current !== p.weapon) {
      a.current = p.weapon;
      a.reloadDoneAt = 0;
    }
    // Allow one in-flight shot of disagreement before snapping.
    if (Math.abs(a.mags[p.weapon]! - p.mag) > 1 || p.reloading !== a.reloadDoneAt > 0) {
      a.mags[p.weapon] = p.mag;
      if (!p.reloading) a.reloadDoneAt = 0;
    }
    a.reserves[p.weapon] = p.reserve;
  }

  onShot(e: ShotEvent): void {
    if (e.shooter === this.me) {
      // Already drawn locally; the server only adds whether it landed.
      if (e.damage > 0) {
        this.hud.hitMarker();
        this.lastHit = `${e.hit}:${e.target}`;
      }
      return;
    }
    this.views.noteShot(e.shooter);
    const muzzle = this.views.muzzle(e.shooter, this.tmp);
    const from: V3 = muzzle ? [muzzle.x, muzzle.y, muzzle.z] : e.from;
    if (this.weapons[e.weapon]?.kind === 'hitscan') {
      this.fx.flash(from);
      this.fx.tracer(from, e.to);
    }
    if (e.hit !== 'none') this.fx.impact(e.to, e.normal, e.hit === 'world' || e.hit === 'vehicle');
  }

  projectileChanged(id: string, p: ProjectileState): void {
    if (p.owner === this.me) return; // shown by local prediction
    let r = this.remote.get(id);
    if (!r) {
      r = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), dieAt: Infinity, gravity: 0 };
      this.remote.set(id, r);
      this.views.noteShot(p.owner);
      const m = this.views.muzzle(p.owner, this.tmp);
      if (m) this.fx.flash([m.x, m.y, m.z]);
    }
    r.pos.set(p.x, p.y, p.z);
    r.vel.set(p.vx, p.vy, p.vz);
    r.syncedAt = this.time;
  }

  projectileRemoved(id: string): void {
    this.remote.delete(id);
  }

  render(dt: number): void {
    this.fx.update(dt);
    const shown: { pos: THREE.Vector3; vel: THREE.Vector3 }[] = [];
    for (let i = this.local.length - 1; i >= 0; i--) {
      const r = this.local[i]!;
      if (this.time > r.dieAt) {
        this.local.splice(i, 1);
        continue;
      }
      const vel = r.vel.toArray() as V3;
      const next = stepProjectile([r.pos.x, r.pos.y, r.pos.z], vel, r.gravity, dt);
      const seg = this.tmp2.set(next[0] - r.pos.x, next[1] - r.pos.y, next[2] - r.pos.z);
      const len = seg.length();
      const hit = this.physics.castRayNormal(r.pos, seg.clone().divideScalar(len || 1), len);
      if (hit) {
        const p = r.pos.clone().addScaledVector(seg, hit.dist / (len || 1));
        this.fx.impact([p.x, p.y, p.z], hit.normal);
        this.local.splice(i, 1);
        continue;
      }
      r.vel.set(...vel);
      r.pos.set(...next);
      shown.push(r);
    }
    for (const r of this.remote.values()) {
      const ahead = this.time - (r.syncedAt ?? this.time);
      shown.push({ pos: r.pos.clone().addScaledVector(r.vel, ahead), vel: r.vel });
    }
    this.fx.setRounds(shown);
  }

  get ammo() {
    const a = this.arsenal;
    return {
      weapon: a.current,
      mag: a.mags[a.current]!,
      reserve: a.reserves[a.current]!,
      reloading: a.reloadDoneAt > 0,
    };
  }

  private predictShot(spec: WeaponSpec): void {
    const me = this.views.get(this.me);
    if (!me) return;
    const origin = me.getWorldPosition(new THREE.Vector3());
    origin.y += AIM_PIVOT_HEIGHT;
    const d = aimDirection(this.orbit.yaw, this.orbit.pitch);
    const dir = new THREE.Vector3(...d);
    const muzzle = this.views.muzzle(this.me, this.tmp) ?? origin;
    const m: V3 = [muzzle.x, muzzle.y, muzzle.z];
    this.fx.flash(m);

    if (spec.kind === 'hitscan') {
      const hit = this.physics.castRayNormal(origin, dir, spec.range);
      const end = origin.clone().addScaledVector(dir, hit ? hit.dist : spec.range);
      this.fx.tracer(m, [end.x, end.y, end.z]);
      if (hit) this.fx.impact([end.x, end.y, end.z], hit.normal);
    } else if (spec.projectile) {
      this.local.push({
        pos: origin.clone(),
        vel: dir.clone().multiplyScalar(spec.projectile.speed),
        dieAt: this.time + spec.projectile.life,
        gravity: spec.projectile.gravity,
      });
    }

    // Recoil kicks the aim itself, so the server sees the same climb on the next shot.
    this.orbit.pitch = Math.min(0.5, this.orbit.pitch + spec.recoil.pitch);
    this.orbit.yaw += (Math.random() - 0.5) * 2 * spec.recoil.yaw;
  }
}

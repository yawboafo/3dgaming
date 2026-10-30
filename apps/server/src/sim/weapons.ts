import RAPIER from '@dimforge/rapier3d-compat';
import {
  AIM_PIVOT_HEIGHT,
  PLAYER,
  ProjectileState,
  aimDirection,
  newArsenal,
  stepProjectile,
  stepWeapon,
  type Arsenal,
  type HitKind,
  type InputFrame,
  type PlayerState,
  type ShotEvent,
  type TownState,
  type WeaponSpec,
} from '@town/shared';
import type { HitRegistry } from './hits.js';

interface Flight {
  state: ProjectileState;
  owner: string;
  weapon: number;
  from: [number, number, number];
  pos: [number, number, number];
  vel: [number, number, number];
  dieAt: number;
}

export interface WeaponHooks {
  /** Collider to ignore for a shooter (their own capsule). */
  colliderOf(sid: string): RAPIER.Collider | undefined;
  broadcast(e: ShotEvent): void;
  /** A player's health reached zero. */
  killed(sid: string, p: PlayerState): void;
}

const RESPAWN_S = 4;

/**
 * Authoritative weapons. Clients only send keys and aim; the server applies fire rate and ammo,
 * ray-casts its own Rapier world (players, props, vehicles, NPCs via the hit registry, everything
 * else is world geometry) and applies damage. Clients predict tracers and impacts for feel only.
 */
export class WeaponSystem {
  private readonly arsenals = new Map<string, Arsenal>();
  private readonly prevKeys = new Map<string, number>();
  private readonly flights = new Map<string, Flight>();
  private readonly respawnAt = new Map<string, number>();
  private nextFlight = 1;

  constructor(
    private readonly world: RAPIER.World,
    private readonly weapons: WeaponSpec[],
    private readonly state: TownState,
    private readonly hits: HitRegistry,
    private readonly hooks: WeaponHooks,
  ) {}

  /** `arsenal` carries ammo over a zone hand-off; otherwise the player starts fully loaded. */
  join(sid: string, p: PlayerState, arsenal?: Arsenal): void {
    this.arsenals.set(
      sid,
      arsenal ? { ...arsenal, nextShotAt: 0, reloadDoneAt: 0 } : newArsenal(this.weapons),
    );
    this.mirror(sid, p);
  }

  export(sid: string): Arsenal | undefined {
    const a = this.arsenals.get(sid);
    return a && { ...a, mags: [...a.mags], reserves: [...a.reserves] };
  }

  leave(sid: string): void {
    this.arsenals.delete(sid);
    this.prevKeys.delete(sid);
    this.respawnAt.delete(sid);
  }

  /** Per player per tick, after movement. */
  update(sid: string, p: PlayerState, input: InputFrame, now: number): void {
    const a = this.arsenals.get(sid);
    if (!a) return;
    const prev = this.prevKeys.get(sid) ?? 0;
    this.prevKeys.set(sid, input.keys);
    if (p.health === 0 || p.vehicle) return;

    const step = stepWeapon(a, this.weapons, input.keys, prev, now);
    if (step.fired) {
      p.yaw = input.yaw; // turn to face the shot
      this.fire(sid, p, a.current, input);
    }
    this.mirror(sid, p);
  }

  /** Once per tick, before the physics step: move rounds and resolve their hits. */
  stepProjectiles(dt: number, now: number): void {
    for (const [id, f] of this.flights) {
      const spec = this.weapons[f.weapon]!.projectile!;
      const next = stepProjectile(f.pos, f.vel, spec.gravity, dt);
      const seg = [next[0] - f.pos[0], next[1] - f.pos[1], next[2] - f.pos[2]];
      const len = Math.hypot(seg[0]!, seg[1]!, seg[2]!);
      const hit = this.cast(f.owner, f.pos, [seg[0]! / len, seg[1]! / len, seg[2]! / len], len);
      if (hit) {
        this.resolve(f.owner, f.weapon, f.from, hit);
        this.remove(id);
        continue;
      }
      f.pos = next;
      Object.assign(f.state, {
        x: next[0],
        y: next[1],
        z: next[2],
        vx: f.vel[0],
        vy: f.vel[1],
        vz: f.vel[2],
      });
      if (now >= f.dieAt) this.remove(id);
    }
  }

  /** Once per tick: bring the dead back. Returns session ids to teleport to the spawn. */
  respawns(now: number): string[] {
    const due: string[] = [];
    for (const [sid, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(sid);
      const p = this.state.players.get(sid);
      if (!p) continue;
      p.health = PLAYER.maxHealth;
      this.arsenals.set(sid, newArsenal(this.weapons));
      this.mirror(sid, p);
      due.push(sid);
    }
    return due;
  }

  /** Damage from any source. Kills start the respawn timer. */
  damagePlayer(sid: string, amount: number, now: number): void {
    const p = this.state.players.get(sid);
    if (!p || p.health === 0) return;
    p.health = Math.max(0, p.health - amount);
    if (p.health === 0) {
      this.respawnAt.set(sid, now + RESPAWN_S);
      this.hooks.killed(sid, p);
    }
  }

  /** Simulation time of the current tick, for damage callbacks registered elsewhere. */
  now = 0;

  private fire(sid: string, p: PlayerState, weapon: number, input: InputFrame): void {
    const spec = this.weapons[weapon]!;
    const from: [number, number, number] = [p.x, p.y + AIM_PIVOT_HEIGHT, p.z];
    const dir = aimDirection(input.yaw, input.pitch);
    if (spec.kind === 'hitscan') {
      const hit = this.cast(sid, from, dir, spec.range);
      if (hit) this.resolve(sid, weapon, from, hit);
      else this.broadcast(sid, weapon, from, add(from, dir, spec.range), [0, 1, 0], 'none', '', 0);
      return;
    }
    const proj = spec.projectile!;
    const id = `x.${this.nextFlight++}`;
    const state = new ProjectileState();
    state.owner = sid;
    const vel: [number, number, number] = [
      dir[0] * proj.speed,
      dir[1] * proj.speed,
      dir[2] * proj.speed,
    ];
    Object.assign(state, {
      x: from[0],
      y: from[1],
      z: from[2],
      vx: vel[0],
      vy: vel[1],
      vz: vel[2],
    });
    this.state.projectiles.set(id, state);
    this.flights.set(id, {
      state,
      owner: sid,
      weapon,
      from,
      pos: [...from],
      vel,
      dieAt: this.now + proj.life,
    });
  }

  private cast(
    sid: string,
    from: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
  ):
    | { point: [number, number, number]; normal: [number, number, number]; handle: number }
    | undefined {
    const ray = new RAPIER.Ray(
      { x: from[0], y: from[1], z: from[2] },
      { x: dir[0], y: dir[1], z: dir[2] },
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      undefined,
      this.hooks.colliderOf(sid),
    );
    if (!hit) return undefined;
    return {
      point: add(from, dir, hit.timeOfImpact),
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      handle: hit.collider.handle,
    };
  }

  private resolve(
    shooter: string,
    weapon: number,
    from: [number, number, number],
    hit: { point: [number, number, number]; normal: [number, number, number]; handle: number },
  ): void {
    const target = this.hits.get(hit.handle);
    const damage = this.weapons[weapon]!.damage;
    let kind: HitKind = 'world';
    if (target) {
      kind = target.kind;
      target.damage?.(damage, shooter);
    }
    this.broadcast(
      shooter,
      weapon,
      from,
      hit.point,
      hit.normal,
      kind,
      target?.id ?? '',
      target?.damage ? damage : 0,
    );
  }

  private broadcast(
    shooter: string,
    weapon: number,
    from: [number, number, number],
    to: [number, number, number],
    normal: [number, number, number],
    hit: HitKind,
    target: string,
    damage: number,
  ): void {
    this.hooks.broadcast({ shooter, weapon, from, to, normal, hit, target, damage });
  }

  private remove(id: string): void {
    this.flights.delete(id);
    this.state.projectiles.delete(id);
  }

  private mirror(sid: string, p: PlayerState): void {
    const a = this.arsenals.get(sid);
    if (!a) return;
    p.weapon = a.current;
    p.mag = a.mags[a.current]!;
    p.reserve = a.reserves[a.current]!;
    p.reloading = a.reloadDoneAt > 0;
  }
}

function add(
  o: [number, number, number],
  d: [number, number, number],
  t: number,
): [number, number, number] {
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

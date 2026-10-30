import type { Vec3 } from '../world.js';

/** world/weapons.json */
export interface WeaponSpec {
  id: string;
  label: string;
  /** Hitscan resolves on the tick it's fired; projectiles fly and resolve on contact. */
  kind: 'hitscan' | 'projectile';
  damage: number;
  /** Seconds between shots. */
  interval: number;
  /** Hold to keep firing (rifle) vs one shot per press (pistol). */
  auto: boolean;
  magazine: number;
  /** Spare rounds carried at spawn. */
  reserve: number;
  /** Reload time (s). */
  reload: number;
  range: number;
  projectile?: { speed: number; gravity: number; life: number };
  /** Camera kick per shot (rad): recoil is aim, so client prediction and server agree. */
  recoil: { pitch: number; yaw: number };
  model: {
    asset: string;
    scale: number;
    /** Which local axis the barrel points along in the model (Kenney blasters: -z). */
    barrel: '+z' | '-z';
    /** Grip point in model space; it sits in the palm. */
    grip: Vec3;
    /** Fine-tuning after the automatic hand alignment (metres / degrees, hand space). */
    offset: Vec3;
    rot: Vec3;
  };
  /** Muzzle in the gun model's space (FX only — shots originate at the aim pivot). */
  muzzle: Vec3;
}

export interface DestructibleSpec {
  asset: string;
  health: number;
  scale: number;
}

export interface WeaponCatalog {
  version: 1;
  weapons: WeaponSpec[];
  props: Record<string, DestructibleSpec>;
}

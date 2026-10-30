import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLAYER } from '@town/shared';

export type Locomotion =
  'idle' | 'armed' | 'aim' | 'walk' | 'run' | 'sprint' | 'air' | 'drive' | 'dead';

/** Quaternius Universal Animation Library clip per locomotion state. */
const CLIPS: Record<Locomotion, string> = {
  idle: 'Idle_Loop',
  armed: 'Pistol_Idle_Loop',
  aim: 'Pistol_Aim_Neutral',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  air: 'Jump_Loop',
  drive: 'Driving_Loop',
  dead: 'Death01',
};
/** Played once and held on the last frame. */
const ONE_SHOT: ReadonlySet<Locomotion> = new Set(['dead']);
const FADE = 0.2;

/**
 * Root motion is the server's job: pin the hips' horizontal translation to the first key so clips
 * play in place, but keep its height (sitting in Driving_Loop, the bob in a run).
 */
function inPlace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const out = clip.clone();
  for (const track of out.tracks) {
    if (!/(hips|pelvis|root).*\.position$/i.test(track.name)) continue;
    const v = track.values;
    for (let i = 3; i < v.length; i += 3) {
      v[i] = v[0]!;
      v[i + 2] = v[2]!;
    }
  }
  return out;
}

/** Template shared by every character instance: mesh + the clip library. */
export interface CharacterTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/** Pick a state from server-derived motion. Thresholds sit between the gait speeds. */
export interface Stance {
  riding?: boolean;
  dead?: boolean;
  /** Holding a weapon (standing still uses the armed idle). */
  armed?: boolean;
  /** Fired recently: hold the aim pose while standing. */
  aiming?: boolean;
}

export function locomotionFor(speed: number, airborne: boolean, s: Stance = {}): Locomotion {
  if (s.dead) return 'dead';
  if (s.riding) return 'drive';
  if (airborne) return 'air';
  if (speed < 0.3) return s.aiming ? 'aim' : s.armed ? 'armed' : 'idle';
  if (speed < (PLAYER.walkSpeed + PLAYER.sprintSpeed) / 2 - 0.75) return 'walk';
  if (speed < PLAYER.sprintSpeed - 0.5) return 'run';
  return 'sprint';
}

/** One animated character: skinned clone + AnimationMixer cross-fading locomotion clips. */
export class CharacterView {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<Locomotion, THREE.AnimationAction>();
  private state: Locomotion = 'idle';

  /** `details: false` drops small face meshes (eyes, brows): crowds don't need them. */
  constructor(t: CharacterTemplate, opts: { details?: boolean } = {}) {
    this.root = cloneSkinned(t.scene);
    const drop: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (opts.details === false && /eye|brow/i.test(o.name)) drop.push(o);
      o.castShadow = true;
      // Clips play in place, so a fixed sphere around the body is a safe culling bound (the
      // bind-pose bounds don't follow the animation).
      if (o instanceof THREE.SkinnedMesh)
        o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    });
    drop.forEach((o) => o.removeFromParent());
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [state, name] of Object.entries(CLIPS) as [Locomotion, string][]) {
      const clip = THREE.AnimationClip.findByName(t.clips, name);
      if (!clip) continue;
      const action = this.mixer.clipAction(inPlace(clip));
      if (ONE_SHOT.has(state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }
    this.actions.get('idle')?.play();
  }

  /** Walk/run clips are authored for a gait speed; scale playback to match ground speed. */
  update(dt: number, speed: number, airborne: boolean, stance: Stance = {}): void {
    const next = locomotionFor(speed, airborne, stance);
    if (next !== this.state) {
      const from = this.actions.get(this.state);
      const to = this.actions.get(next);
      if (to) {
        to.reset().play();
        if (from) to.crossFadeFrom(from, FADE, false);
      }
      this.state = next;
    }
    const a = this.actions.get(this.state);
    if (a) {
      const nominal = { walk: PLAYER.walkSpeed, run: 4.5, sprint: PLAYER.sprintSpeed }[
        this.state as 'walk' | 'run' | 'sprint'
      ];
      a.timeScale = nominal ? THREE.MathUtils.clamp(speed / nominal, 0.6, 1.4) : 1;
    }
    this.mixer.update(dt);
  }

  /** Right-hand bone, where the held weapon goes. */
  get hand(): THREE.Object3D | undefined {
    return (this.handBone ??= this.root.getObjectByName('hand_r'));
  }
  private handBone?: THREE.Object3D;

  get locomotion(): Locomotion {
    return this.state;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

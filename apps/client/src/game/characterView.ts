import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLAYER } from '@town/shared';

export type Locomotion = 'idle' | 'walk' | 'run' | 'sprint' | 'air';

/** Quaternius Universal Animation Library clip per locomotion state. */
const CLIPS: Record<Locomotion, string> = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  air: 'Jump_Loop',
};
const FADE = 0.2;

/** Template shared by every character instance: mesh + the clip library. */
export interface CharacterTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/** Pick a state from server-derived motion. Thresholds sit between the gait speeds. */
export function locomotionFor(speed: number, airborne: boolean): Locomotion {
  if (airborne) return 'air';
  if (speed < 0.3) return 'idle';
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

  constructor(t: CharacterTemplate) {
    this.root = cloneSkinned(t.scene);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned bounds don't follow the pose
      }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [state, name] of Object.entries(CLIPS) as [Locomotion, string][]) {
      const clip = THREE.AnimationClip.findByName(t.clips, name);
      if (!clip) continue;
      // Root motion is the server's job: drop the hips' translation so clips play in place.
      const inPlace = clip.clone();
      inPlace.tracks = inPlace.tracks.filter(
        (tr) => !/(hips|pelvis|root).*\.position$/i.test(tr.name),
      );
      this.actions.set(state, this.mixer.clipAction(inPlace));
    }
    this.actions.get('idle')?.play();
  }

  /** Walk/run clips are authored for a gait speed; scale playback to match ground speed. */
  update(dt: number, speed: number, airborne: boolean): void {
    const next = locomotionFor(speed, airborne);
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

  get locomotion(): Locomotion {
    return this.state;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

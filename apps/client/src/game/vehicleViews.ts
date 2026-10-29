import * as THREE from 'three';
import { clamp, type VehicleCatalog, type VehicleSpec, type VehicleState } from '@town/shared';
import type { AssetLoader } from '../assets/loader.js';
import { buildInterior } from '../world/interiorScene.js';

interface Wheel {
  /** Pivot turned for steering; the mesh inside spins. */
  steerPivot: THREE.Object3D;
  spin: THREE.Object3D;
  radius: number;
  steers: boolean;
}

interface View {
  spec: VehicleSpec;
  root: THREE.Group;
  /** Leans (bikes) without disturbing the root transform. */
  body: THREE.Group;
  seat: THREE.Object3D;
  wheels: Wheel[];
  target: { pos: THREE.Vector3; quat: THREE.Quaternion; steer: number; speed: number };
  steer: number;
  speed: number;
  lean: number;
  driver: string;
}

const SMOOTH_PER_SECOND = 14;

/**
 * Cosmetic vehicles: smoothed toward server poses, wheels spun from speed and turned from the
 * server's steer angle, bikes leaned into turns. Physics never runs here.
 */
export class VehicleViews {
  private readonly views = new Map<string, View>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader: AssetLoader,
    private readonly catalog: VehicleCatalog,
  ) {}

  async upsert(id: string, s: VehicleState): Promise<void> {
    let v = this.views.get(id);
    if (!v) {
      const spec = this.catalog.kinds[s.kind];
      if (!spec) return;
      v = await this.build(spec);
      v.root.position.set(s.x, s.y, s.z);
      v.root.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      this.scene.add(v.root);
      this.views.set(id, v);
    }
    v.target.pos.set(s.x, s.y, s.z);
    v.target.quat.set(s.qx, s.qy, s.qz, s.qw);
    v.target.steer = s.steer;
    v.target.speed = s.speed;
    v.driver = s.driver;
  }

  render(dt: number, visible: boolean): void {
    const k = 1 - Math.exp(-SMOOTH_PER_SECOND * dt);
    for (const v of this.views.values()) {
      v.root.visible = visible;
      v.root.position.lerp(v.target.pos, k);
      v.root.quaternion.slerp(v.target.quat, k);
      v.steer += (v.target.steer - v.steer) * k;
      v.speed += (v.target.speed - v.speed) * k;
      for (const w of v.wheels) {
        if (w.steers) w.steerPivot.rotation.y = v.steer;
        w.spin.rotation.x += (v.speed * dt) / w.radius;
      }
      if (v.spec.leanMax) {
        const maxSteer = v.spec.engine.maxSteer || 1;
        const want = -(v.steer / maxSteer) * v.spec.leanMax * clamp(Math.abs(v.speed) / 8, 0, 1);
        v.lean += (want - v.lean) * k * 0.6;
        v.body.rotation.z = v.lean;
      }
    }
  }

  /** Where a rider sits (an Object3D that follows smoothing and lean). */
  seat(id: string): THREE.Object3D | undefined {
    return this.views.get(id)?.seat;
  }

  root(id: string): THREE.Object3D | undefined {
    return this.views.get(id)?.root;
  }

  spec(id: string): VehicleSpec | undefined {
    return this.views.get(id)?.spec;
  }

  speed(id: string): number {
    return this.views.get(id)?.speed ?? 0;
  }

  entries(): IterableIterator<
    [string, { root: THREE.Object3D; driver: string; spec: VehicleSpec }]
  > {
    return this.views.entries();
  }

  private async build(spec: VehicleSpec): Promise<View> {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const model = new THREE.Group();
    model.scale.setScalar(spec.model.scale);
    body.add(model);

    const wheels: Wheel[] = [];
    if (spec.model.asset) {
      const gltf = await this.loader.load(spec.model.asset);
      model.add(gltf.scene.clone(true));
    }
    if (spec.model.parts) {
      model.add(buildInterior({ origin: [0, 0, 0], boxes: spec.model.parts, lights: [] } as never));
    }
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    for (const w of spec.wheels) {
      let spin: THREE.Object3D | undefined;
      let steerPivot: THREE.Object3D;
      const node = w.node ? model.getObjectByName(w.node) : undefined;
      if (node?.parent) {
        // Wrap the glTF wheel node: pivot steers, the node itself spins.
        steerPivot = new THREE.Group();
        steerPivot.position.copy(node.position);
        node.parent.add(steerPivot);
        node.position.set(0, 0, 0);
        steerPivot.add(node);
        spin = node;
      } else {
        steerPivot = new THREE.Group();
        steerPivot.position.set(w.pos[0], w.radius, w.pos[2]);
        body.add(steerPivot);
        spin = new THREE.Group();
        if (w.asset) {
          const wheel = (await this.loader.load(w.asset)).scene.clone(true);
          if (w.scale) wheel.scale.set(...w.scale);
          spin.add(wheel);
        }
        steerPivot.add(spin);
      }
      wheels.push({ steerPivot, spin, radius: w.radius, steers: w.steer });
    }

    const seat = new THREE.Object3D();
    seat.position.set(...spec.seat);
    body.add(seat);
    return {
      spec,
      root,
      body,
      seat,
      wheels,
      target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), steer: 0, speed: 0 },
      steer: 0,
      speed: 0,
      lean: 0,
      driver: '',
    };
  }
}

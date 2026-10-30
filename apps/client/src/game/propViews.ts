import * as THREE from 'three';
import type { WeaponCatalog, WorldDef } from '@town/shared';
import type { AssetLoader } from '../assets/loader.js';
import type { ShotFx } from '../fx/shotFx.js';

/** Destructible props (server-owned). Drawn from town.json; hidden with a burst when destroyed. */
export class PropViews {
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly shakeUntil = new Map<string, number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fx: ShotFx,
  ) {}

  async load(town: WorldDef, catalog: WeaponCatalog, loader: AssetLoader): Promise<void> {
    await Promise.all(
      town.destructibles.map(async (d, i) => {
        const spec = catalog.props[d.kind];
        if (!spec) return;
        const obj = (await loader.load(spec.asset)).scene.clone(true);
        obj.scale.setScalar(spec.scale);
        obj.position.set(...d.pos);
        obj.rotation.y = (d.rotY * Math.PI) / 180;
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
        });
        obj.userData.home = obj.position.clone();
        this.scene.add(obj);
        this.meshes.set(`d.${i}`, obj);
      }),
    );
  }

  damaged(id: string): void {
    this.shakeUntil.set(id, performance.now() + 150);
  }

  destroyed(id: string): void {
    const m = this.meshes.get(id);
    if (!m || !m.visible) return;
    m.visible = false;
    const p = m.position;
    for (let i = 0; i < 3; i++) this.fx.impact([p.x, p.y + 0.4, p.z], [0, 1, 0], false);
  }

  get alive(): number {
    let n = 0;
    for (const m of this.meshes.values()) if (m.visible) n++;
    return n;
  }

  render(): void {
    const now = performance.now();
    for (const [id, until] of this.shakeUntil) {
      const m = this.meshes.get(id);
      if (!m) continue;
      const home = m.userData.home as THREE.Vector3;
      if (now > until) {
        m.position.copy(home);
        this.shakeUntil.delete(id);
      } else {
        m.position.set(
          home.x + (Math.random() - 0.5) * 0.06,
          home.y,
          home.z + (Math.random() - 0.5) * 0.06,
        );
      }
    }
  }
}

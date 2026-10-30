import * as THREE from 'three';

type V3 = [number, number, number];

const TRACER_S = 0.08;
const FLASH_S = 0.05;
const SPARK_S = 0.25;
const DECAL_S = 12;
const MAX_DECALS = 64;
const MAX_ROUNDS = 48;

interface Timed<T extends THREE.Object3D> {
  obj: T;
  until: number;
}

/**
 * Cosmetic shot effects, all pooled (no allocation per shot): tracers, muzzle flashes, impact
 * decals, sparks and rifle rounds in flight. Additive meshes only, never lights, so firing can't
 * change the scene's light count and trigger shader recompiles.
 */
export class ShotFx {
  readonly group = new THREE.Group();
  private readonly tracers: Timed<THREE.Line>[] = [];
  private readonly flashes: Timed<THREE.Mesh>[] = [];
  private readonly sparks: Timed<THREE.Mesh>[] = [];
  private readonly decals: Timed<THREE.Mesh>[] = [];
  private readonly rounds: THREE.Mesh[] = [];
  private nextDecal = 0;
  private time = 0;

  private readonly tracerMat = new THREE.LineBasicMaterial({
    color: '#ffe7a3',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly glowMat = new THREE.MeshBasicMaterial({
    color: '#ffcf6b',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly decalMat = new THREE.MeshBasicMaterial({
    color: '#1b1410',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private readonly flashGeo = new THREE.SphereGeometry(0.09, 8, 6);
  private readonly sparkGeo = new THREE.SphereGeometry(0.05, 6, 4);
  private readonly decalGeo = new THREE.CircleGeometry(0.07, 10);
  private readonly roundGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5).rotateX(Math.PI / 2);

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  tracer(from: V3, to: V3): void {
    const t = this.take(this.tracers, () => {
      const g = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      return new THREE.Line(g, this.tracerMat);
    });
    const pos = t.obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, ...from);
    pos.setXYZ(1, ...to);
    pos.needsUpdate = true;
    t.obj.geometry.computeBoundingSphere();
    t.until = this.time + TRACER_S;
  }

  flash(at: V3): void {
    const f = this.take(this.flashes, () => new THREE.Mesh(this.flashGeo, this.glowMat));
    f.obj.position.set(...at);
    f.obj.scale.setScalar(0.8 + Math.random() * 0.6);
    f.until = this.time + FLASH_S;
  }

  /** Bullet hole plus a few sparks; `normal` faces out of the surface. */
  impact(at: V3, normal: V3, decal = true): void {
    for (let i = 0; i < 4; i++) {
      const s = this.take(this.sparks, () => new THREE.Mesh(this.sparkGeo, this.glowMat));
      s.obj.position.set(
        at[0] + normal[0] * 0.05 + (Math.random() - 0.5) * 0.15,
        at[1] + normal[1] * 0.05 + Math.random() * 0.12,
        at[2] + normal[2] * 0.05 + (Math.random() - 0.5) * 0.15,
      );
      s.until = this.time + SPARK_S * (0.5 + Math.random() * 0.5);
    }
    if (!decal) return;
    let d = this.decals[this.nextDecal];
    if (!d) {
      d = { obj: new THREE.Mesh(this.decalGeo, this.decalMat), until: 0 };
      this.decals.push(d);
      this.group.add(d.obj);
    }
    this.nextDecal = (this.nextDecal + 1) % MAX_DECALS;
    const n = new THREE.Vector3(...normal);
    d.obj.position.set(at[0] + n.x * 0.01, at[1] + n.y * 0.01, at[2] + n.z * 0.01);
    d.obj.lookAt(d.obj.position.clone().add(n));
    d.obj.visible = true;
    d.until = this.time + DECAL_S;
  }

  /** Rifle rounds in flight: positions set each frame by the caller (first n are used). */
  setRounds(positions: { pos: THREE.Vector3; vel: THREE.Vector3 }[]): void {
    const n = Math.min(positions.length, MAX_ROUNDS);
    while (this.rounds.length < n) {
      const m = new THREE.Mesh(this.roundGeo, this.glowMat);
      this.rounds.push(m);
      this.group.add(m);
    }
    this.rounds.forEach((m, i) => {
      const r = positions[i];
      m.visible = !!r && i < n;
      if (!r) return;
      m.position.copy(r.pos);
      m.lookAt(r.pos.clone().add(r.vel));
    });
  }

  dispose(): void {
    this.group.removeFromParent();
  }

  update(dt: number): void {
    this.time += dt;
    for (const list of [
      this.tracers,
      this.flashes,
      this.sparks,
      this.decals,
    ] as Timed<THREE.Object3D>[][]) {
      for (const t of list) if (t.obj.visible && this.time > t.until) t.obj.visible = false;
    }
    for (const s of this.sparks) if (s.obj.visible) s.obj.position.y -= dt * 1.5;
  }

  private take<T extends THREE.Object3D>(pool: Timed<T>[], make: () => T): Timed<T> {
    let t = pool.find((p) => !p.obj.visible);
    if (!t) {
      t = { obj: make(), until: 0 };
      pool.push(t);
      this.group.add(t.obj);
    }
    t.obj.visible = true;
    return t;
  }
}

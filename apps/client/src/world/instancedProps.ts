import * as THREE from 'three';
import { chunkKey, type ChunkDef, type WorldDef } from '@town/shared';
import type { AssetLoader } from '../assets/loader.js';

interface Batch {
  meshes: THREE.InstancedMesh[];
  /** Per-mesh local transform baked from the glTF node hierarchy. */
  locals: THREE.Matrix4[];
  /** Instance transforms per loaded chunk. */
  byChunk: Map<string, THREE.Matrix4[]>;
}

const tmp = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

/**
 * Static props drawn with one InstancedMesh per (asset, primitive) across all loaded chunks,
 * so draw calls scale with asset variety, not prop count. Capacity is the asset's town-wide
 * count, allocated once.
 */
export class InstancedProps {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Promise<Batch>>();
  private readonly capacity = new Map<string, number>();

  constructor(
    private readonly loader: AssetLoader,
    town: WorldDef,
  ) {
    for (const c of town.chunks)
      for (const p of c.props) this.capacity.set(p.asset, (this.capacity.get(p.asset) ?? 0) + 1);
  }

  private batch(id: string): Promise<Batch> {
    let b = this.batches.get(id);
    if (!b) {
      b = this.loader.load(id).then((gltf) => {
        const out: Batch = { meshes: [], locals: [], byChunk: new Map() };
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const im = new THREE.InstancedMesh(o.geometry, o.material, this.capacity.get(id) ?? 1);
          im.name = id;
          im.count = 0;
          im.castShadow = true;
          im.receiveShadow = true;
          im.frustumCulled = false; // instances span chunks; per-instance culling isn't worth it here
          this.group.add(im);
          out.meshes.push(im);
          out.locals.push(o.matrixWorld.clone());
        });
        return out;
      });
      this.batches.set(id, b);
    }
    return b;
  }

  async addChunk(chunk: ChunkDef): Promise<void> {
    const key = chunkKey(chunk);
    const byAsset = new Map<string, THREE.Matrix4[]>();
    for (const p of chunk.props) {
      const s = this.loader.scale(p.asset).map((v) => v * (p.scale ?? 1));
      q.setFromAxisAngle(up, (p.rotY * Math.PI) / 180);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.pos),
        q,
        new THREE.Vector3(s[0], s[1], s[2]),
      );
      const list = byAsset.get(p.asset) ?? [];
      list.push(m);
      byAsset.set(p.asset, list);
    }
    await Promise.all(
      [...byAsset].map(async ([id, mats]) => {
        const b = await this.batch(id);
        b.byChunk.set(key, mats);
        rebuild(b);
      }),
    );
  }

  removeChunk(chunk: ChunkDef): void {
    const key = chunkKey(chunk);
    const ids = new Set(chunk.props.map((p) => p.asset));
    for (const id of ids) {
      void this.batches.get(id)?.then((b) => {
        if (b.byChunk.delete(key)) rebuild(b);
      });
    }
  }
}

function rebuild(b: Batch): void {
  b.meshes.forEach((im, i) => {
    let n = 0;
    for (const mats of b.byChunk.values()) {
      for (const m of mats) im.setMatrixAt(n++, tmp.multiplyMatrices(m, b.locals[i]!));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  });
}

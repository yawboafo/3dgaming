import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetDef, AssetManifest, Vec3 } from '@town/shared';

export const ASSET_ROOT = '/game-assets/';

/** What callers use from a glTF; placeholders provide the same shape. */
export type LoadedAsset = Pick<GLTF, 'scene' | 'animations'>;

/** One GLTFLoader for the app: meshopt geometry + KTX2 textures, cached per URL. */
export class AssetLoader {
  private readonly gltf: GLTFLoader;
  private readonly cache = new Map<string, Promise<LoadedAsset>>();

  constructor(
    renderer: THREE.WebGLRenderer | { isWebGPURenderer: true },
    readonly manifest: AssetManifest,
  ) {
    const ktx2 = new KTX2Loader().setTranscoderPath('/basis/');
    ktx2.detectSupport(renderer as THREE.WebGLRenderer);
    this.gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  }

  def(id: string): AssetDef {
    const d = this.manifest.assets[id];
    if (!d) throw new Error(`Unknown asset "${id}"`);
    return d;
  }

  scale(id: string): Vec3 {
    const s = this.def(id).scale ?? 1;
    return Array.isArray(s) ? s : [s, s, s];
  }

  /**
   * Missing art never breaks the game: if the .glb is absent (e.g. CI without assets/raw) or the
   * def has no url, a primitive placeholder stands in.
   */
  load(id: string): Promise<LoadedAsset> {
    const def = this.def(id);
    const key = def.url ?? `placeholder:${id}`;
    let p = this.cache.get(key);
    if (!p) {
      p = def.url
        ? this.gltf.loadAsync(ASSET_ROOT + def.url).catch((err: unknown) => {
            console.warn(`[assets] ${id}: ${String(err)} — using placeholder`);
            return placeholder(def);
          })
        : Promise.resolve(placeholder(def));
      this.cache.set(key, p);
    }
    return p;
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const placeholderMaterials = new Map<string, THREE.MeshStandardMaterial>();

/** Unit-ish primitive (scaled by the asset's base scale like real art), sitting on y = 0. */
function placeholder(def: AssetDef): LoadedAsset {
  const p = def.placeholder ?? { shape: 'box' as const, size: [1, 1, 1] as Vec3, color: '#b9a48a' };
  const [w, h, d] = p.size;
  const geo =
    p.shape === 'cylinder'
      ? new THREE.CylinderGeometry(w / 2, w / 2, h, 12)
      : new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  let mat = placeholderMaterials.get(p.color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9 });
    placeholderMaterials.set(p.color, mat);
  }
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geo, mat));
  return { scene, animations: [] };
}

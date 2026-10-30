// Builds small glTF documents in memory for pipeline tests (no binary fixtures in the repo).
import { Document, NodeIO } from '@gltf-transform/core';

/** A unit-ish box mesh of `size` (metres), sitting on y = 0 at the node's origin unless lifted. */
export function boxMesh(doc, size = [1, 1, 1], lift = 0) {
  const [w, h, d] = size;
  const x = w / 2;
  const z = d / 2;
  const p = new Float32Array([
    -x,
    lift,
    -z,
    x,
    lift,
    -z,
    x,
    lift,
    z,
    -x,
    lift,
    z,
    -x,
    lift + h,
    -z,
    x,
    lift + h,
    -z,
    x,
    lift + h,
    z,
    -x,
    lift + h,
    z,
  ]);
  // prettier-ignore
  const idx = new Uint16Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos = doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buffer);
  const ind = doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind);
  const mat = doc.getRoot().listMaterials()[0] ?? doc.createMaterial('paint');
  prim.setMaterial(mat);
  return doc.createMesh().addPrimitive(prim);
}

/** nodes: [{ name, size, translation?, scale?, lift? }] → Document with one scene. */
export function makeAsset(nodes) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);
  for (const n of nodes) {
    const node = doc.createNode(n.name).setMesh(boxMesh(doc, n.size, n.lift ?? 0));
    if (n.translation) node.setTranslation(n.translation);
    if (n.scale) node.setScale(n.scale);
    scene.addChild(node);
  }
  return doc;
}

export async function writeAsset(path, nodes) {
  await new NodeIO().write(path, makeAsset(nodes));
}

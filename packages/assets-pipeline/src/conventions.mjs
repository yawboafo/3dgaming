// Authoring conventions for assets/raw/**/*.glb (see docs/blender-workflow.md).
// Pure functions over a @gltf-transform Document so they are unit-testable with generated files.
import { getBounds } from '@gltf-transform/core';

/** Collision proxy nodes: COL_<anything>. Each becomes one box collider and is never rendered. */
export const COLLIDER = /^COL_/i;
/** Level-of-detail nodes: <base>_LOD0, <base>_LOD1, … LOD0 is the full-detail model. */
export const LOD = /_LOD(\d)$/i;
/** File names: lowercase kebab-case, optionally with digits (house-type-a.glb, crate-2.glb). */
export const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_BUDGET = { tris: 8000, textureSize: 1024, materials: 4 };

const triangles = (mesh) =>
  mesh
    .listPrimitives()
    .reduce(
      (n, p) =>
        n +
        Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3),
      0,
    );

/** World-space AABB of one node's mesh (POSITION accessor bounds through the node's world matrix). */
function nodeBox(node) {
  const mesh = node.getMesh();
  if (!mesh) return undefined;
  const m = node.getWorldMatrix();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const lo = pos.getMin([]);
    const hi = pos.getMax([]);
    for (let c = 0; c < 8; c++) {
      const p = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
      const w = [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], w[i]);
        max[i] = Math.max(max[i], w[i]);
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Read a raw asset: collision proxies, LOD levels, render bounds and stats, plus convention
 * problems. Does not modify the document.
 */
export function inspect(doc, { name, budget = DEFAULT_BUDGET, strict = false, checks = {} } = {}) {
  const errors = [];
  const warnings = [];
  const problem = (msg, hard = false) => (hard || strict ? errors : warnings).push(msg);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const nodes = doc.getRoot().listNodes();

  if (name !== undefined && !FILE_NAME.test(name))
    problem(`file name "${name}" is not lowercase-kebab-case`);

  // Collision proxies: boxes from COL_ nodes (in asset space, centred + half extents).
  const colliders = [];
  for (const n of nodes.filter((n) => COLLIDER.test(n.getName()))) {
    const box = nodeBox(n);
    if (!box) {
      problem(`collision proxy "${n.getName()}" has no mesh`, true);
      continue;
    }
    colliders.push({
      center: [0, 1, 2].map((i) => r4((box.min[i] + box.max[i]) / 2)),
      half: [0, 1, 2].map((i) => r4((box.max[i] - box.min[i]) / 2)),
    });
  }

  // LOD levels by suffix; nodes without a suffix appear at every level.
  const lodLevels = new Set();
  for (const n of nodes) {
    const m = LOD.exec(n.getName());
    if (m) lodLevels.add(Number(m[1]));
  }
  const levels = [...lodLevels].sort((a, b) => a - b);
  if (levels.length && levels[0] !== 0)
    problem(`LODs start at LOD${levels[0]}; the full-detail model must be _LOD0`, true);
  levels.forEach(
    (l, i) =>
      i > 0 &&
      l !== levels[i - 1] + 1 &&
      problem(`LOD levels skip from ${levels[i - 1]} to ${l}`, true),
  );

  // Render bounds and budgets: LOD0 + unsuffixed meshes, never collision proxies.
  const renders = (n) =>
    n.getMesh() &&
    !COLLIDER.test(n.getName()) &&
    !(LOD.exec(n.getName()) && LOD.exec(n.getName())[1] !== '0');
  const renderNodes = nodes.filter(renders);
  if (renderNodes.length === 0) problem('no renderable meshes', true);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of renderNodes) {
    const b = nodeBox(n);
    if (!b) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  const bounds = Number.isFinite(min[0])
    ? { min: min.map(r4), max: max.map(r4) }
    : getBounds(scene);
  const size = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
  const largest = Math.max(...size);
  if (largest > 300)
    problem(
      `largest dimension is ${largest.toFixed(1)} m — exported in centimetres? (1 unit = 1 m)`,
      true,
    );
  if (largest < 0.01)
    problem(`largest dimension is ${(largest * 1000).toFixed(2)} mm — scale not applied?`, true);
  if (checks.origin !== false && Math.abs(bounds.min[1]) > 0.05)
    problem(
      `origin is ${bounds.min[1].toFixed(2)} m from the model's base; put the origin on the ground`,
    );

  const tris = renderNodes.reduce((n, node) => n + triangles(node.getMesh()), 0);
  if (tris > budget.tris) problem(`${tris} triangles at LOD0 (budget ${budget.tris})`);
  const materials = doc.getRoot().listMaterials().length;
  if (materials > budget.materials)
    problem(`${materials} materials (budget ${budget.materials}); each one is a draw call`);
  for (const t of doc.getRoot().listTextures()) {
    const s = t.getSize();
    if (!t.getImage() && !t.getURI())
      problem(`texture "${t.getName() || '?'}" has no image data`, true);
    if (!s) continue;
    const [w, h] = s;
    const pow2 = (v) => (v & (v - 1)) === 0;
    if (!pow2(w) || !pow2(h))
      problem(`texture "${t.getName() || t.getURI()}" is ${w}×${h}; use powers of two`);
    if (Math.max(w, h) > budget.textureSize * 2)
      problem(
        `texture "${t.getName() || t.getURI()}" is ${w}×${h}; it will be resized to ${budget.textureSize}`,
      );
  }

  return { colliders, lods: levels, bounds, tris, materials, errors, warnings };
}

/**
 * Remove collision proxies (and every LOD except `level`) from the document in place, so the
 * rendered file only contains what's drawn at that level.
 */
export function stripForLevel(doc, level) {
  for (const n of doc.getRoot().listNodes()) {
    const lod = LOD.exec(n.getName());
    if (COLLIDER.test(n.getName()) || (lod && Number(lod[1]) !== level)) n.dispose();
  }
}

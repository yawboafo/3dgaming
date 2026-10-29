// Optimises every .glb under assets/raw into assets/build, mirroring the folder layout, and
// writes world/asset-bounds.json (local-space AABB per asset, committed) for collider generation.
// Wraps @gltf-transform/cli; see docs/blender-workflow.md for authoring conventions.
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const rawDir = join(root, 'assets/raw');
const outDir = join(root, 'assets/build');
const cli = join(here, '../node_modules/.bin/gltf-transform');
const run = promisify(execFile);
const force = process.argv.includes('--force');

/** KTX2 encoding needs KTX-Software's `ktx` binary on PATH. */
const hasKtx = spawnSync('ktx', ['--version']).status === 0;

function* glbs(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue; // _downloads etc.
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* glbs(p);
    else if (name.endsWith('.glb')) yield p;
  }
}

/** Assets named `hero` (e.g. `hero_car.glb`, `hero/…`) keep 2048 px textures; everything else 1024. */
const isHero = (rel) => /(^|[/_-])hero([/_.-]|$)/i.test(rel);

async function buildOne(src) {
  const rel = relative(rawDir, src);
  const dst = join(outDir, rel);
  mkdirSync(dirname(dst), { recursive: true });
  if (!force && statSync(dst, { throwIfNoEntry: false })?.mtimeMs > statSync(src).mtimeMs)
    return false;
  const textureSize = isHero(rel) ? 2048 : 1024;
  // optimize = dedup + instance + palette + flatten + join + weld + resample + prune + resize + quantize + meshopt
  // Without KTX-Software, fall back to WebP so placeholders stay inside the download budget.
  await run(cli, [
    'optimize',
    src,
    dst,
    '--compress',
    'meshopt',
    '--texture-compress',
    hasKtx ? 'false' : 'webp',
    '--texture-size',
    String(textureSize),
    '--simplify',
    'false',
  ]);
  if (hasKtx) await run(cli, ['uastc', dst, dst, '--level', '2', '--rdo', '--zstd', '18']);
  return true;
}

const files = [...glbs(rawDir)];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bounds = {};
for (const src of files) {
  const doc = await io.read(src);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  bounds[relative(rawDir, src).split('\\').join('/')] = {
    min: b.min.map((v) => +v.toFixed(4)),
    max: b.max.map((v) => +v.toFixed(4)),
  };
}

let built = 0;
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.max(1, cpus().length - 1) }, async () => {
    for (let src = queue.shift(); src; src = queue.shift()) if (await buildOne(src)) built++;
  }),
);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(root, 'world/asset-bounds.json'), JSON.stringify(bounds, null, 1) + '\n');
if (!hasKtx && built > 0) {
  console.warn(
    '[assets] `ktx` not found — textures written as WebP. Install KTX-Software for KTX2/UASTC.',
  );
}
console.log(
  `[assets] ${built} built, ${files.length - built} up to date → ${relative(root, outDir)}`,
);

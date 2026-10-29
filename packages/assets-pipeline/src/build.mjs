// Optimises every .glb under assets/raw into assets/build, mirroring the folder layout.
// Wraps @gltf-transform/cli; see docs/blender-workflow.md for authoring conventions.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDir = join(root, 'assets/raw');
const outDir = join(root, 'assets/build');
const cli = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/.bin/gltf-transform');

/** KTX2 encoding needs KTX-Software's `ktx` binary on PATH. */
const hasKtx = spawnSync('ktx', ['--version']).status === 0;

function* glbs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* glbs(p);
    else if (name.endsWith('.glb')) yield p;
  }
}

const run = (...args) => execFileSync(cli, args, { stdio: 'inherit' });

let count = 0;
for (const src of glbs(rawDir)) {
  const rel = relative(rawDir, src);
  const dst = join(outDir, rel);
  mkdirSync(dirname(dst), { recursive: true });
  const textureSize = /(^|[/_-])hero([/_.-]|$)/.test(rel) ? 2048 : 1024;

  // optimize = dedup + instance + palette + flatten + join + weld + simplify(off) + resize + prune + quantize + meshopt
  run(
    'optimize',
    src,
    dst,
    '--compress',
    'meshopt',
    '--texture-compress',
    'false',
    '--texture-size',
    String(textureSize),
    '--simplify',
    'false',
  );
  if (hasKtx) run('uastc', dst, dst, '--level', '2', '--rdo', '--zstd', '18');
  count++;
}

if (!hasKtx && count > 0) {
  console.warn(
    '[assets] `ktx` not found — textures left uncompressed. Install KTX-Software for KTX2/UASTC.',
  );
}
console.log(`[assets] built ${count} file(s) → ${relative(root, outDir)}`);

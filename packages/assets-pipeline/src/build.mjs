// pnpm assets:build [-- --force] [-- --register]
//
// Validates every .glb under assets/raw (naming, scale, origin, budgets, collision proxies, LODs —
// see docs/blender-workflow.md), then optimises each into assets/build with @gltf-transform/cli:
// resize textures (≤1024, ≤2048 for `hero` assets), dedup, instance, join, weld, prune, quantize,
// meshopt geometry, KTX2/UASTC textures (WebP if KTX-Software isn't installed). COL_* proxies are
// stripped from the render files and recorded with the bounds in world/asset-bounds.json; LODs are
// split into name.glb (LOD0), name.lod1.glb, … `--register` adds new files to world/assets.json.
import { execFile, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { DEFAULT_BUDGET, inspect, stripForLevel } from './conventions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const arg = (name, def) =>
  process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : def;
const rawDir = resolve(arg('raw', join(root, 'assets/raw')));
const outDir = resolve(arg('out', join(root, 'assets/build')));
const boundsFile = resolve(arg('bounds', join(root, 'world/asset-bounds.json')));
const manifestFile = resolve(arg('manifest', join(root, 'world/assets.json')));
const rulesFile = resolve(arg('rules', join(root, 'assets/pipeline.json')));
const force = process.argv.includes('--force');
const register = process.argv.includes('--register');
const cli = join(here, '../node_modules/.bin/gltf-transform');
const run = promisify(execFile);

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

/**
 * Per-path overrides (committed in assets/pipeline.json). Every rule whose `match` prefixes the
 * path applies, in file order, so later (more specific) rules override earlier ones.
 */
const rules = JSON.parse(readFileSync(rulesFile, 'utf8')).rules ?? [];
const posix = (p) => p.split('\\').join('/');
const ruleFor = (rel) =>
  rules
    .filter((r) => posix(rel).startsWith(r.match))
    .reduce(
      (acc, r) => ({
        ...acc,
        ...r,
        budget: { ...acc.budget, ...r.budget },
        checks: { ...acc.checks, ...r.checks },
      }),
      { budget: {}, checks: {} },
    );

/** Assets named `hero` (e.g. `hero-car.glb`, `hero/…`) keep 2048 px textures; everything else 1024. */
const isHero = (rel) => /(^|[/_-])hero([/_.-]|$)/i.test(rel);

async function optimize(src, dst, rel) {
  mkdirSync(dirname(dst), { recursive: true });
  const rule = ruleFor(rel);
  const keep = [];
  if (rule.join === false) keep.push('--join', 'false');
  if (rule.flatten === false) keep.push('--flatten', 'false');
  // optimize = dedup + instance + palette + flatten + join + weld + resample + prune + resize + quantize + meshopt
  await run(cli, [
    'optimize',
    src,
    dst,
    '--compress',
    'meshopt',
    '--texture-compress',
    hasKtx ? 'false' : 'webp',
    '--texture-size',
    String(isHero(rel) ? 2048 : 1024),
    '--simplify',
    'false',
    ...keep,
  ]);
  if (hasKtx) await run(cli, ['uastc', dst, dst, '--level', '2', '--rdo', '--zstd', '18']);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const scratch = mkdtempSync(join(tmpdir(), 'town-assets-'));
const files = [...glbs(rawDir)];
const bounds = {};
const report = [];
const jobs = [];

for (const src of files) {
  const rel = posix(relative(rawDir, src));
  const rule = ruleFor(rel);
  const budget = { ...DEFAULT_BUDGET, ...(rule.budget ?? {}) };
  const doc = await io.read(src);
  const info = inspect(doc, {
    name: basename(rel, '.glb'),
    budget,
    strict: rule.strict === true,
    checks: rule.checks,
  });
  report.push({ rel, ...info });
  if (info.errors.length) continue;
  bounds[rel] = {
    min: info.bounds.min,
    max: info.bounds.max,
    ...(info.colliders.length ? { colliders: info.colliders } : {}),
    ...(info.lods.length > 1 ? { lods: info.lods.length } : {}),
  };
  const dst = join(outDir, rel);
  const fresh = !force && statSync(dst, { throwIfNoEntry: false })?.mtimeMs > statSync(src).mtimeMs;
  if (fresh) continue;
  const special = info.colliders.length > 0 || info.lods.length > 0;
  if (!special) {
    jobs.push(() => optimize(src, dst, rel));
    continue;
  }
  // Write a stripped copy per LOD level, then optimise each.
  for (const level of info.lods.length ? info.lods : [0]) {
    const copy = await io.read(src);
    stripForLevel(copy, level);
    const tmp = join(scratch, `${rel.replace(/[/\\]/g, '__')}.lod${level}.glb`);
    await io.write(tmp, copy);
    const out = level === 0 ? dst : dst.replace(/\.glb$/, `.lod${level}.glb`);
    jobs.push(() => optimize(tmp, out, rel));
  }
}

let built = 0;
const queue = [...jobs];
await Promise.all(
  Array.from({ length: Math.max(1, cpus().length - 1) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job();
      built++;
    }
  }),
);
rmSync(scratch, { recursive: true, force: true });

// Keep bounds for files that failed validation this time (so the town still generates).
const previous = statSync(boundsFile, { throwIfNoEntry: false })
  ? JSON.parse(readFileSync(boundsFile, 'utf8'))
  : {};
for (const r of report) if (r.errors.length && previous[r.rel]) bounds[r.rel] = previous[r.rel];
mkdirSync(dirname(boundsFile), { recursive: true });
writeFileSync(boundsFile, JSON.stringify(bounds, null, 1) + '\n');

if (register) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const known = new Set(Object.values(manifest.assets).map((a) => a.url));
  let added = 0;
  for (const r of report) {
    if (r.errors.length || known.has(r.rel)) continue;
    let id = basename(r.rel, '.glb');
    if (manifest.assets[id])
      id = posix(r.rel)
        .replace(/\.glb$/, '')
        .replace(/\//g, '-');
    manifest.assets[id] = { url: r.rel, scale: 1, collider: 'box' };
    console.log(`[assets] registered "${id}" → ${r.rel}`);
    added++;
  }
  if (added) writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

// Report: only files with something to say, so a clean run stays quiet.
let errorCount = 0;
for (const r of report) {
  if (!r.errors.length && !r.warnings.length) continue;
  console.log(
    `\n${r.errors.length ? '✗' : '!'} ${r.rel}  (${r.tris} tris, ${r.materials} materials${r.colliders.length ? `, ${r.colliders.length} COL` : ''}${r.lods.length > 1 ? `, ${r.lods.length} LODs` : ''})`,
  );
  for (const e of r.errors) console.log(`    error: ${e}`);
  for (const w of r.warnings) console.log(`    warn:  ${w}`);
  errorCount += r.errors.length;
}
if (!hasKtx && built > 0)
  console.warn(
    '\n[assets] `ktx` not found — textures written as WebP. Install KTX-Software for KTX2/UASTC.',
  );
const failed = report.filter((r) => r.errors.length).length;
const warned = report.filter((r) => !r.errors.length && r.warnings.length).length;
console.log(
  `\n[assets] ${files.length} files: ${built} outputs built, ${files.length - failed - warned} clean, ${warned} with warnings, ${failed} rejected → ${posix(relative(root, outDir))}`,
);
process.exit(errorCount ? 1 : 0);

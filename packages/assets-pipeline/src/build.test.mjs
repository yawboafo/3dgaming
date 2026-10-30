import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeAsset } from './fixtures.mjs';

const script = new URL('./build.mjs', import.meta.url).pathname;
let dir;
/** glTF node names straight from a .glb's JSON chunk. */
const glbNodeNames = (file) => {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return (JSON.parse(b.subarray(20, 20 + len).toString('utf8')).nodes ?? []).map(
    (n) => n.name ?? '',
  );
};
const run = (...extra) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', [script, ...paths(), ...extra], { encoding: 'utf8' }),
    };
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
};
const paths = () => [
  '--raw',
  join(dir, 'raw'),
  '--out',
  join(dir, 'build'),
  '--bounds',
  join(dir, 'bounds.json'),
  '--manifest',
  join(dir, 'assets.json'),
  '--rules',
  join(dir, 'pipeline.json'),
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));
  mkdirSync(join(dir, 'raw/town'), { recursive: true });
  writeFileSync(
    join(dir, 'pipeline.json'),
    JSON.stringify({ rules: [{ match: 'town/', strict: true }] }),
  );
  writeFileSync(join(dir, 'assets.json'), JSON.stringify({ version: 1, assets: {} }));
  // A good Blender-style export: two LODs and a collision proxy.
  await writeAsset(join(dir, 'raw/town/market-stall.glb'), [
    { name: 'stall_LOD0', size: [3, 2.5, 2] },
    { name: 'stall_LOD1', size: [3, 2.5, 2] },
    { name: 'COL_stall', size: [3, 1, 2] },
  ]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('pnpm assets:build', () => {
  it('builds LOD files, records proxies, strips them from the output and registers the asset', async () => {
    const r = run('--register');
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(dir, 'build/town/market-stall.glb'))).toBe(true);
    expect(existsSync(join(dir, 'build/town/market-stall.lod1.glb'))).toBe(true);

    const bounds = JSON.parse(readFileSync(join(dir, 'bounds.json'), 'utf8'))[
      'town/market-stall.glb'
    ];
    expect(bounds.colliders).toEqual([{ center: [0, 0.5, 0], half: [1.5, 0.5, 1] }]);
    expect(bounds.lods).toBe(2);

    // Node names live in the GLB's JSON chunk: no need to decode the meshopt geometry.
    expect(
      glbNodeNames(join(dir, 'build/town/market-stall.glb')).some((n) => /^COL_/.test(n)),
    ).toBe(false);
    expect(glbNodeNames(join(dir, 'build/town/market-stall.lod1.glb')).length).toBeGreaterThan(0);

    const manifest = JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8'));
    expect(manifest.assets['market-stall']).toMatchObject({ url: 'town/market-stall.glb' });
  });

  it('rejects a strict-folder file that breaks the conventions, with a non-zero exit', async () => {
    await writeAsset(join(dir, 'raw/town/Big Hut.glb'), [{ name: 'hut', size: [500, 300, 500] }]);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Big Hut\.glb/);
    expect(r.out).toMatch(/centimetres/);
    expect(existsSync(join(dir, 'build/town/Big Hut.glb'))).toBe(false);
    rmSync(join(dir, 'raw/town/Big Hut.glb'));
  });
});

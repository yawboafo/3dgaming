import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldDef } from '@town/shared';

/** world/ lives at the repo root in dev; Docker sets WORLD_DIR. */
const worldDir =
  process.env.WORLD_DIR ?? resolve(fileURLToPath(import.meta.url), '../../../../../world');

export function loadTown(): WorldDef {
  return JSON.parse(readFileSync(resolve(worldDir, 'town.json'), 'utf8')) as WorldDef;
}

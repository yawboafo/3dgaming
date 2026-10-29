import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const threeDir = join(import.meta.dirname, 'node_modules/three');

/** Data and art live outside the client package; serve them in dev and copy them on build. */
const STATIC: Record<string, string> = {
  '/game-assets/': join(root, 'assets/build'),
  '/world/': join(root, 'world'),
  '/basis/': join(threeDir, 'examples/jsm/libs/basis'),
};

const TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
};

function staticDirs(): Plugin {
  let outDir = 'dist';
  return {
    name: 'town-static-dirs',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const prefix = Object.keys(STATIC).find((p) => url.startsWith(p));
        if (!prefix) return next();
        const file = normalize(join(STATIC[prefix]!, url.slice(prefix.length)));
        if (!file.startsWith(STATIC[prefix]!) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const [prefix, dir] of Object.entries(STATIC)) {
        if (existsSync(dir)) cpSync(dir, join(outDir, prefix), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [staticDirs()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});

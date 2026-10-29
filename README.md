# Town

Browser-based 3D open-world game — Phase 0: a small low-poly West-African coastal town you can
walk, drive and shoot in, backed by an authoritative Colyseus server from day one.

> "Town" is a working name. Rename via `GAME_NAME` in `packages/shared/src/constants.ts` and the
> `@town/*` package scope.

## Layout

| Path                       | What                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `apps/client`              | Vite + Three.js client (WebGL2; WebGPU with `?gpu=1`)                     |
| `apps/server`              | Node 22 + Colyseus authoritative server, headless Rapier                  |
| `packages/shared`          | Colyseus schema, input types, tick rates, chunk grid, shared sim code     |
| `packages/assets-pipeline` | `pnpm assets:build` — gltf-transform optimisation of `assets/raw → build` |
| `world/`                   | `town.json` (chunks, props, colliders) and `assets.json` (asset manifest) |
| `e2e/`                     | Playwright smoke test                                                     |

## Run it

Requires Node ≥ 22 and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

That starts the server on `ws://localhost:2567` and the client on <http://localhost:5173>.
Single-player is the same code path: the client joins a room on your local server.

- <http://localhost:5173/debug> — budget overlay (FPS, draw calls, physics step, chunk load, ping).
- `?gpu=1` — WebGPU renderer. `?server=ws://host:port` — point at another server.

Controls (so far): drag the mouse to orbit, WASD to move, Shift to sprint, Space to jump.

### Postgres + Redis (optional locally)

```bash
pnpm db:up
```

Set `REDIS_URL=redis://localhost:6379` before `pnpm dev` to run the server with
`RedisPresence` + `RedisDriver` (needed once there's more than one server process).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm exec playwright install chromium && pnpm e2e
```

CI (`.github/workflows/ci.yml`) runs format, lint, build, typecheck, unit tests, the Playwright
smoke test and a Docker build.

## Deploy

- **Client → Cloudflare Pages:** build command `pnpm --filter @town/client build`, output
  `apps/client/dist`. Set `VITE_SERVER_URL=wss://<your-server>` at build time.
- **Server → Fly.io:** `fly deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile .`
  (run from the repo root). Local image: `docker compose --profile full up --build`.

## Netcode in one paragraph

The server simulates at a fixed 20 Hz (`setFixedTimestep`) and consumes exactly one input per
player per step, always integrating with its own fixed `dt`. The client sends one input frame per
server tick over Colyseus's input channel and renders at display rate. State is delta-synced via
`@colyseus/schema`; `lastSeq` on each player is the reconciliation ack. Prediction,
reconciliation and 100 ms remote interpolation land in deliverable 7 using `@colyseus/sdk`'s
`Predict` module.

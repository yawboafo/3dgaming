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

Controls (so far): click the view to capture the mouse, move it to orbit (wheel zooms), WASD to
move, Shift to sprint, Space to jump, E to use what the prompt shows (doors, vehicles). Esc
releases the mouse. Driving: W/S throttle and brake (hold S to reverse), A/D steer, Space
handbrake, E to get out. Shooting: left mouse (or F) fires, R reloads, 1/2 switch pistol/rifle.

### Art and the town

Placeholder art (Kenney + Quaternius, CC0) is not committed — see `assets/SOURCES.md` for where to
get each pack and which folder under `assets/raw/` it goes in. Then:

```bash
pnpm assets:build
```

That validates every model (scale, origin, names, budgets, `COL_` collision proxies, `_LOD` levels),
optimises them into `assets/build/` (meshopt geometry; KTX2 textures if KTX-Software's `ktx` is
installed, otherwise WebP) and refreshes `world/asset-bounds.json`. `-- --register` adds new files
to `world/assets.json`. Artists: see [docs/blender-workflow.md](docs/blender-workflow.md).

Without any art the game still runs: every asset in `world/assets.json` has a `placeholder`
primitive the client draws instead (this is what CI sees).

```bash
pnpm town:gen
```

That regenerates `world/town.json` (roads, houses, trees, lights and their box colliders per 64 m
chunk) from `world/assets.json` + `world/asset-bounds.json`. Pass `-- --seed N` for another
layout. The result is plain data — hand edits or a Blender-authored layout can replace it.

Enterable buildings: the generator puts a door trigger (an `Interactable`: id, prompt, range,
action) in front of three houses near the centre. Each leads to `world/interiors/<id>.json`, a
room of coloured boxes, lights and an exit trigger. Interiors sit about 2 km outside the town in
the same physics world, so entering one is a server-side teleport; the client loads the room's
sub-scene on demand and hides the town while you're inside. Edit those JSON files to change the
rooms.

Vehicles: every tunable (mass, ballast, suspension, engine, brakes, steering, seat, exit points)
lives in `world/vehicles.json`. The server simulates them with Rapier's ray-cast vehicle
controller at 60 Hz (three sub-steps per 20 Hz tick); the motorbike uses the same controller
with two wheels, stays upright physically, and leans only visually. `assets/pipeline.json` keeps
the car models' wheel nodes separate so they can spin and steer.

Weapons (`world/weapons.json`): a hitscan pistol and a projectile rifle. Clients send only keys
and aim; the server applies fire rate and ammo, ray-casts its own Rapier world (players, NPCs,
vehicles and destructible props are told apart by collider) and applies damage. The client
predicts its own muzzle flash, tracer, impact decal and recoil with the same shared rules, then
adopts the server's ammo count and shows a hit marker when the server confirms a hit. Knocked-out
players respawn after 4 s. Destructible crates and targets are listed in `town.json`.

NPCs (server-driven, interpolated on clients): 20 pedestrians are Yuka vehicles following
three-pathfinding paths over a sidewalk navmesh. `town:gen` stores the walkable area as a 2 m
bitmap in `town.json` and the server bakes the zone at startup. A small Yuka state machine moves
them between walk, flee (gunfire within 30 m, or being hit) and down. Six traffic cars follow
Catmull-Rom loops in the right-hand lane, brake for anything in the lane ahead and hurry away
from gunfire. Pedestrians and traffic have kinematic colliders, so the server's shots and
players' bodies interact with them.

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

## Netcode, zones and scaling

- **Authoritative server, fixed timestep.** Rooms simulate at 20 Hz (`setFixedTimestep`, three
  60 Hz physics sub-steps for vehicles) and consume exactly one input per player per tick,
  always with the server's own `dt`.
- **Local player: prediction + reconciliation.** The client sends one input per tick and predicts
  it immediately with the same Rapier character motor the server runs (`@colyseus/sdk`
  `Predict.reconciler`). When the server's state arrives it rewinds to it and replays the inputs
  the server hasn't acknowledged; any error is smoothed out over a few frames, and teleports
  (doors, respawns, zone hand-offs) snap.
- **Everyone else: 100 ms interpolation.** Remote players, pedestrians and vehicles are drawn
  100 ms in the past between buffered snapshots (`Predict` in `lerp` mode).
- **Zones.** The town is split into zone rooms, one per 2×2 chunk block (128 m), matched by
  `joinOrCreate('town', { zone })` (`filterBy`). A room owns the vehicles, props, traffic loops
  and pedestrians in its zone. When a player crosses the border, the room parks their state
  (position, health, ammo, the vehicle they're driving) in presence under a one-time token,
  reserves a seat in the neighbour's room through the matchmaker and sends the reservation; the
  client takes it and drops the old room. State never travels through the client.
- **Interest management.** Entity collections are view-filtered; each client's `StateView`
  holds only what's within 2 chunks of it (refreshed at 10 Hz).
- **Many processes.** With `REDIS_URL` set the server uses `RedisPresence` + `RedisDriver`, so
  zone rooms (and hand-offs between them) span processes and machines. Give each process its own
  `PUBLIC_ADDRESS` (`host:port`) so seat reservations route to it.

```bash
REDIS_URL=redis://localhost:6379 PORT=2567 PUBLIC_ADDRESS=localhost:2567 pnpm --filter @town/server dev
```

### Load test

```bash
pnpm loadtest -- --url ws://localhost:2567 --bots 32 --seconds 60
```

32 bots join the spawn zone, wander, sprint, shoot and follow hand-offs. The report lists each
zone's tick and physics p95/max (from the rooms' own stats) and per-bot downstream bandwidth.
`apps/server/scripts/zone-handoff-check.mjs` checks a hand-off end to end; CI runs it against two
processes sharing Redis (`--cross-process`) and asserts the new room was on the other process.

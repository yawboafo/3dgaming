import * as THREE from 'three';
import { Callbacks } from '@colyseus/sdk';
import {
  FixedTimestep,
  GAME_NAME,
  SERVER_DT,
  ServerMsg,
  TOWN_SPACE,
  type AssetManifest,
  type ServerStats,
  type VehicleCatalog,
  type WeaponCatalog,
  type WorldDef,
} from '@town/shared';
import { createRenderer } from './render/createRenderer.js';
import { createScene } from './render/scene.js';
import { Keyboard } from './input/keyboard.js';
import { inputChannel, joinTown } from './net/connection.js';
import { PlayerViews } from './game/players.js';
import { OrbitCamera } from './game/orbitCamera.js';
import { DebugOverlay } from './debug/overlay.js';
import { AssetLoader, fetchJson } from './assets/loader.js';
import { InstancedProps } from './world/instancedProps.js';
import { ChunkStreamer } from './world/chunkStreamer.js';
import { ClientPhysics } from './physics/clientPhysics.js';
import { PromptHud } from './hud/prompt.js';
import { Spaces } from './game/spaces.js';
import { VehicleViews } from './game/vehicleViews.js';
import { loadGunTemplates, setupCombat } from './game/combatSetup.js';
import { NpcViews } from './game/npcViews.js';
import { installTestHook } from './debug/testHook.js';

/** Bytes fetched so far (compressed on the wire where the browser reports it). */
function downloadedMb(): number {
  const entries = [
    ...performance.getEntriesByType('navigation'),
    ...performance.getEntriesByType('resource'),
  ] as PerformanceResourceTiming[];
  return entries.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) / 1e6;
}

async function boot(): Promise<void> {
  document.title = GAME_NAME;
  const container = document.getElementById('app')!;
  const status = document.getElementById('status')!;
  const gfx = await createRenderer(container);
  const { scene, follow: sunFollow, setIndoors } = createScene();
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    600,
  );
  if (location.pathname.startsWith('/debug'))
    (window as unknown as { __scene: THREE.Scene }).__scene = scene;
  const keyboard = new Keyboard();
  const debug = new DebugOverlay();

  addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    gfx.renderer.setSize(container.clientWidth, container.clientHeight);
  });

  status.textContent = 'Loading town…';
  const [manifest, town, catalog, weaponCatalog, physics] = await Promise.all([
    fetchJson<AssetManifest>('/world/assets.json'),
    fetchJson<WorldDef>('/world/town.json'),
    fetchJson<VehicleCatalog>('/world/vehicles.json'),
    fetchJson<WeaponCatalog>('/world/weapons.json'),
    ClientPhysics.create(),
  ]);
  const loader = new AssetLoader(gfx.renderer as THREE.WebGLRenderer, manifest);
  const props = new InstancedProps(loader, town);
  scene.add(props.group);
  const streamer = new ChunkStreamer(town, [props, physics]);
  streamer.update(town.spawn[0], town.spawn[2]);

  const [body, female, anims, guns] = await Promise.all([
    loader.load('character-male'),
    loader.load('character-female'),
    loader.load('anim-library'),
    loadGunTemplates(weaponCatalog, loader),
  ]);
  await streamer.settle();
  const orbit = new OrbitCamera(camera, gfx.renderer.domElement, physics);
  orbit.yaw = town.spawnYaw;
  const hud = new PromptHud();
  const spaces = new Spaces(town, {
    scene,
    town: props.group,
    physics,
    hud,
    setIndoors,
    faceYaw: (yaw) => (orbit.yaw = yaw),
  });

  status.textContent = 'Connecting…';
  const room = await joinTown('Player');
  status.textContent = `Connected · ${room.roomId} · click to look around`;
  const vehicles = new VehicleViews(scene, loader, catalog);
  const views = new PlayerViews(
    scene,
    { scene: body.scene, clips: anims.animations },
    (id) => vehicles.seat(id),
    guns,
  );
  const shooting = await setupCombat({
    room,
    scene,
    town,
    catalog: weaponCatalog,
    loader,
    views,
    physics,
    orbit,
  });
  const playerTemplate = { scene: body.scene, clips: anims.animations };
  const npcs = new NpcViews(
    scene,
    {
      'character-male': playerTemplate,
      'character-female': { scene: female.scene, clips: anims.animations },
    },
    playerTemplate,
  );
  const cb = Callbacks.get(room);
  cb.onAdd('npcs', (n, id) => {
    npcs.upsert(id, n);
    cb.onChange(n, () => npcs.upsert(id, n));
  });
  cb.onRemove('npcs', (_n, id) => npcs.remove(id));
  cb.onAdd('players', (p, id) => {
    views.upsert(id, p);
    cb.onChange(p, () => {
      views.upsert(id, p);
      if (id === room.sessionId) shooting.combat.reconcile(p);
    });
  });
  cb.onRemove('players', (_p, id) => views.remove(id));
  cb.onAdd('vehicles', (v, id) => {
    void vehicles.upsert(id, v);
    cb.onChange(v, () => void vehicles.upsert(id, v));
  });

  let pingMs = 0;
  let serverStats: ServerStats | undefined;
  setInterval(() => room.ping((ms) => (pingMs = ms)), 1000);
  room.onMessage(ServerMsg.Stats, (s: ServerStats) => (serverStats = s));
  const initialMb = downloadedMb();

  // Fixed-step input at the server's advertised tick; rendering runs at display rate.
  const input = inputChannel(room);
  const sim = new FixedTimestep(input.stepSeconds ?? SERVER_DT);
  let seq = 0;
  installTestHook({
    room,
    seq: () => seq,
    views,
    streamer,
    spaces,
    hud,
    vehicles,
    combat: shooting.combat,
    props: shooting.props,
    npcs,
    orbit,
  });

  const tmpFocus = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  let last = performance.now();
  gfx.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const { steps } = sim.advance(dt);
    for (let i = 0; i < steps; i++) {
      const keys = keyboard.sample();
      Object.assign(input.data, {
        seq: ++seq,
        dt: sim.dt,
        keys,
        yaw: orbit.yaw,
        pitch: orbit.pitch,
      });
      input.send();
      // After sending: the shot uses this frame's aim, recoil lands on the next one.
      shooting.combat.step(keys, sim.dt, room.state.players.get(room.sessionId));
    }

    const state = room.state.players.get(room.sessionId);
    if (state) spaces.sync(state.space, state.yaw);
    vehicles.render(dt, spaces.current === TOWN_SPACE);
    views.render(dt, spaces.current);
    spaces.syncVehicles(vehicles.entries());
    const riding = views.vehicleOf(room.sessionId);
    const focusObj = riding ? vehicles.root(riding) : views.get(room.sessionId);
    if (focusObj && !spaces.busy) {
      const focus = focusObj.getWorldPosition(tmpFocus);
      // The town stays loaded while indoors so stepping back out is instant.
      if (spaces.current === TOWN_SPACE) streamer.update(focus.x, focus.z);
      const spec = riding ? vehicles.spec(riding) : undefined;
      orbit.chase = spec && {
        // Camera yaw convention: π sits behind something facing +Z.
        yaw: tmpEuler.setFromQuaternion(focusObj.quaternion, 'YXZ').y + Math.PI,
        distance: spec.keepUpright ? 4.5 : 7,
        height: spec.keepUpright ? 1.4 : 1.8,
      };
      npcs.render(dt, focus, spaces.current === TOWN_SPACE);
      orbit.update(focus, dt);
      sunFollow(focus);
      const show = state && spaces.current === state.space;
      hud.show(show ? spaces.prompt(state.x, state.y, state.z, !!riding) : undefined);
    }
    shooting.render(dt);
    gfx.renderer.render(scene, camera);

    debug.frame(dt);
    debug.show({
      fps: debug.fps,
      frameMs: dt * 1000,
      drawCalls: gfx.drawCalls(),
      pingMs,
      renderer: gfx.kind,
      serverTick: room.state.tick,
      chunks: streamer.loadedCount,
      locomotion: views.locomotion(room.sessionId),
      physicsStepMs: serverStats?.physicsStepMs,
      physicsStepMaxMs: serverStats?.physicsStepMaxMs,
      chunkLoadMs: streamer.maxLoadMs,
      downloadMb: initialMb,
    });
  });
}

boot().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Could not start: ${String(err?.message ?? err)}`;
});

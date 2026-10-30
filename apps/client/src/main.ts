import * as THREE from 'three';
import {
  GAME_NAME,
  TOWN_SPACE,
  type AssetManifest,
  type VehicleCatalog,
  type WeaponCatalog,
  type WorldDef,
} from '@town/shared';
import { createRenderer } from './render/createRenderer.js';
import { createScene } from './render/scene.js';
import { Keyboard } from './input/keyboard.js';
import { consumeHandoff, joinZoneAt } from './net/connection.js';
import { OrbitCamera } from './game/orbitCamera.js';
import { DebugOverlay } from './debug/overlay.js';
import { AssetLoader, fetchJson } from './assets/loader.js';
import { InstancedProps } from './world/instancedProps.js';
import { ChunkStreamer } from './world/chunkStreamer.js';
import { ClientPhysics } from './physics/clientPhysics.js';
import { PromptHud } from './hud/prompt.js';
import { Spaces } from './game/spaces.js';
import { loadGunTemplates } from './game/combatSetup.js';
import { Session, type WorldContext } from './game/session.js';

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

  const world: WorldContext = {
    scene,
    town,
    loader,
    vehicles: catalog,
    weapons: weaponCatalog,
    physics,
    orbit,
    spaces,
    streamer,
    hud,
    keyboard,
    templates: {
      male: { scene: body.scene, clips: anims.animations },
      female: { scene: female.scene, clips: anims.animations },
      guns,
    },
  };

  status.textContent = 'Connecting…';
  let session = await Session.start(
    await joinZoneAt(town.spawn[0], town.spawn[2], 'Player'),
    world,
  );
  let handingOff = false;
  const adopt = (s: Session) => {
    session = s;
    status.textContent = `Connected · ${s.room.roomId} · click to look around`;
    s.onHandoff = (reservation) => {
      if (handingOff) return;
      handingOff = true;
      // Join the next zone first, then let go of this one, so the player never disappears.
      void consumeHandoff(reservation)
        .then(async (room) => {
          const old = session;
          const next = await Session.start(room, world);
          old.dispose();
          void old.room.leave();
          adopt(next);
          handoffs++;
        })
        .catch((err) => console.error('[handoff]', err))
        .finally(() => (handingOff = false));
    };
  };
  let handoffs = 0;
  adopt(session);
  (window as unknown as { __handoffs: () => number }).__handoffs = () => handoffs;
  const initialMb = downloadedMb();

  const tmpFocus = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  let last = performance.now();
  gfx.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    session.frame(dt, now);

    const state = session.me;
    if (state) spaces.sync(state.space, state.yaw);
    const riding = session.views.vehicleOf(session.room.sessionId);
    const focusObj = riding
      ? session.vehicles.root(riding)
      : session.views.get(session.room.sessionId);
    if (focusObj && !spaces.busy) {
      const focus = focusObj.getWorldPosition(tmpFocus);
      // The town stays loaded while indoors so stepping back out is instant.
      if (spaces.current === TOWN_SPACE) streamer.update(focus.x, focus.z);
      const spec = riding ? session.vehicles.spec(riding) : undefined;
      orbit.chase = spec && {
        // Camera yaw convention: π sits behind something facing +Z.
        yaw: tmpEuler.setFromQuaternion(focusObj.quaternion, 'YXZ').y + Math.PI,
        distance: spec.keepUpright ? 4.5 : 7,
        height: spec.keepUpright ? 1.4 : 1.8,
      };
      session.renderNpcs(dt, focus);
      orbit.update(focus, dt);
      sunFollow(focus);
      const show = state && spaces.current === state.space;
      hud.show(show ? spaces.prompt(state.x, state.y, state.z, !!riding) : undefined);
    }
    gfx.renderer.render(scene, camera);

    debug.frame(dt);
    debug.show({
      fps: debug.fps,
      frameMs: dt * 1000,
      drawCalls: gfx.drawCalls(),
      pingMs: session.pingMs,
      renderer: gfx.kind,
      serverTick: session.room.state.tick,
      chunks: streamer.loadedCount,
      locomotion: session.views.locomotion(session.room.sessionId),
      physicsStepMs: session.stats?.physicsStepMs,
      physicsStepMaxMs: session.stats?.physicsStepMaxMs,
      chunkLoadMs: streamer.maxLoadMs,
      downloadMb: initialMb,
      zone: session.stats?.zone ?? '',
      tickMs: session.stats?.tickMs,
    });
  });
}

boot().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Could not start: ${String(err?.message ?? err)}`;
});

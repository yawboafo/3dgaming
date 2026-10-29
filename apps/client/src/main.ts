import * as THREE from 'three';
import { Callbacks } from '@colyseus/sdk';
import {
  FixedTimestep,
  GAME_NAME,
  SERVER_DT,
  ServerMsg,
  type AssetManifest,
  type ServerStats,
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

/** Test hook read by the Playwright smoke test. Cosmetic/diagnostic only. */
declare global {
  interface Window {
    __town?: {
      sessionId: string;
      tick: number;
      seq: number;
      pos: () => { x: number; y: number; z: number } | undefined;
      views: () => number;
      chunks: () => number;
      locomotion: () => string | undefined;
    };
  }
}

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
  const { scene, follow: sunFollow } = createScene();
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    600,
  );
  const keyboard = new Keyboard();
  const debug = new DebugOverlay();

  addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    gfx.renderer.setSize(container.clientWidth, container.clientHeight);
  });

  status.textContent = 'Loading town…';
  const [manifest, town, physics] = await Promise.all([
    fetchJson<AssetManifest>('/world/assets.json'),
    fetchJson<WorldDef>('/world/town.json'),
    ClientPhysics.create(),
  ]);
  const loader = new AssetLoader(gfx.renderer as THREE.WebGLRenderer, manifest);
  const props = new InstancedProps(loader, town);
  scene.add(props.group);
  const streamer = new ChunkStreamer(town, [props, physics]);
  streamer.update(town.spawn[0], town.spawn[2]);

  const [body, anims] = await Promise.all([
    loader.load('character-male'),
    loader.load('anim-library'),
  ]);
  await streamer.settle();
  const orbit = new OrbitCamera(camera, gfx.renderer.domElement, physics);

  status.textContent = 'Connecting…';
  const room = await joinTown('Player');
  status.textContent = `Connected · ${room.roomId} · click to look around`;
  const views = new PlayerViews(scene, { scene: body.scene, clips: anims.animations });
  const cb = Callbacks.get(room);
  cb.onAdd('players', (p, id) => {
    views.upsert(id, p);
    cb.onChange(p, () => views.upsert(id, p));
  });
  cb.onRemove('players', (_p, id) => views.remove(id));

  let pingMs = 0;
  let serverStats: ServerStats | undefined;
  setInterval(() => room.ping((ms) => (pingMs = ms)), 1000);
  room.onMessage(ServerMsg.Stats, (s: ServerStats) => (serverStats = s));
  const initialMb = downloadedMb();

  // Fixed-step input at the server's advertised tick; rendering runs at display rate.
  const input = inputChannel(room);
  const sim = new FixedTimestep(input.stepSeconds ?? SERVER_DT);
  let seq = 0;
  window.__town = {
    sessionId: room.sessionId,
    get tick() {
      return room.state.tick;
    },
    get seq() {
      return seq;
    },
    pos: () => {
      const p = room.state.players.get(room.sessionId);
      return p && { x: p.x, y: p.y, z: p.z };
    },
    views: () => views.size,
    chunks: () => streamer.loadedCount,
    locomotion: () => views.locomotion(room.sessionId),
  };

  let last = performance.now();
  gfx.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const { steps } = sim.advance(dt);
    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, {
        seq: ++seq,
        dt: sim.dt,
        keys: keyboard.keys,
        yaw: orbit.yaw,
        pitch: orbit.pitch,
      });
      input.send();
    }

    views.render(dt);
    const me = views.get(room.sessionId);
    if (me) {
      streamer.update(me.position.x, me.position.z);
      orbit.update(me.position, dt);
      sunFollow(me.position);
    }
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

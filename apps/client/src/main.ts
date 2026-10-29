import * as THREE from 'three';
import { Callbacks } from '@colyseus/sdk';
import { FixedTimestep, GAME_NAME, SERVER_DT } from '@town/shared';
import { createRenderer } from './render/createRenderer.js';
import { createScene } from './render/scene.js';
import { Keyboard } from './input/keyboard.js';
import { inputChannel, joinTown } from './net/connection.js';
import { PlayerViews } from './game/players.js';
import { FollowCamera } from './game/followCamera.js';
import { DebugOverlay } from './debug/overlay.js';

/** Test hook read by the Playwright smoke test. Cosmetic/diagnostic only. */
declare global {
  interface Window {
    __town?: {
      sessionId: string;
      tick: number;
      seq: number;
      pos: () => { x: number; y: number; z: number } | undefined;
      views: () => number;
    };
  }
}

async function boot(): Promise<void> {
  document.title = GAME_NAME;
  const container = document.getElementById('app')!;
  const status = document.getElementById('status')!;
  const gfx = await createRenderer(container);
  const { scene } = createScene();
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    600,
  );
  const follow = new FollowCamera(camera, gfx.renderer.domElement);
  const keyboard = new Keyboard();
  const debug = new DebugOverlay();

  addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    gfx.renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const room = await joinTown('Player');
  status.textContent = `Connected · ${room.roomId}`;
  const views = new PlayerViews(scene, room.sessionId);
  const cb = Callbacks.get(room);
  cb.onAdd('players', (p, id) => {
    views.upsert(id, p);
    cb.onChange(p, () => views.upsert(id, p));
  });
  cb.onRemove('players', (_p, id) => views.remove(id));

  let pingMs = 0;
  setInterval(() => room.ping((ms) => (pingMs = ms)), 1000);

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
  };

  let last = performance.now();
  gfx.renderer.setAnimationLoop((now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    const { steps } = sim.advance(dt);
    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, {
        seq: ++seq,
        dt: sim.dt,
        keys: keyboard.keys,
        yaw: follow.yaw,
        pitch: follow.pitch,
      });
      input.send();
    }

    views.render(dt);
    const me = views.get(room.sessionId);
    if (me) follow.update(me.position);
    gfx.renderer.render(scene, camera);

    debug.frame(dt);
    debug.show({
      fps: debug.fps,
      frameMs: dt * 1000,
      drawCalls: gfx.drawCalls(),
      pingMs,
      renderer: gfx.kind,
      serverTick: room.state.tick,
    });
  });
}

boot().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Could not connect: ${String(err?.message ?? err)}`;
});

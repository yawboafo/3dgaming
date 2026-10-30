import * as THREE from 'three';
import { Callbacks, Predict, type Room } from '@colyseus/sdk';
import {
  ServerMsg,
  TOWN_SPACE,
  type InputFrame,
  type PlayerState,
  type ServerStats,
  type TownState,
  type VehicleCatalog,
  type WeaponCatalog,
  type WorldDef,
} from '@town/shared';
import type { AssetLoader } from '../assets/loader.js';
import { installTestHook } from '../debug/testHook.js';
import type { PromptHud } from '../hud/prompt.js';
import type { Keyboard } from '../input/keyboard.js';
import { inputChannel } from '../net/connection.js';
import type { ClientPhysics } from '../physics/clientPhysics.js';
import type { ChunkStreamer } from '../world/chunkStreamer.js';
import type { CharacterTemplate } from './characterView.js';
import { setupCombat } from './combatSetup.js';
import type { GunTemplate } from './gunAttach.js';
import { NpcViews } from './npcViews.js';
import type { OrbitCamera } from './orbitCamera.js';
import { PlayerViews } from './players.js';
import type { Spaces } from './spaces.js';
import { VehicleViews } from './vehicleViews.js';

/** Everything that outlives a room: the scene, loaded art and the local world. */
export interface WorldContext {
  scene: THREE.Scene;
  town: WorldDef;
  loader: AssetLoader;
  vehicles: VehicleCatalog;
  weapons: WeaponCatalog;
  physics: ClientPhysics;
  orbit: OrbitCamera;
  spaces: Spaces;
  streamer: ChunkStreamer;
  hud: PromptHud;
  keyboard: Keyboard;
  templates: { male: CharacterTemplate; female: CharacterTemplate; guns: GunTemplate[] };
}

/** Remote entities are drawn this far in the past so two snapshots usually bracket the frame. */
const INTERPOLATION_MS = 100;
/** Jumps larger than this are teleports (doors, respawns, hand-offs): cut, don't glide. */
const SNAP_M = 6;
const ME = 'me';

/**
 * Everything bound to one room: state callbacks, entity views, combat, and the prediction stack.
 * A zone hand-off disposes this and starts a new Session on the next room; the world stays.
 *
 * Netcode is Colyseus' own: `Predict` interpolates remote players, NPCs and vehicles 100 ms in
 * the past, and a `Reconciler` predicts the local player with the same Rapier character motor the
 * server runs, rewinding to the server's state and replaying unacknowledged inputs.
 */
export class Session {
  readonly views: PlayerViews;
  readonly vehicles: VehicleViews;
  readonly npcs: NpcViews;
  private readonly predict: Predict<TownState>;
  private readonly input;
  private readonly shooting;
  private reconciler?: { state: PlayerState };
  private seq = 0;
  private disposed = false;
  pingMs = 0;
  stats?: ServerStats;
  /** Set by the server when the player crosses into another zone. */
  onHandoff?: (reservation: unknown) => void;
  private readonly timers: ReturnType<typeof setInterval>[] = [];

  private constructor(
    readonly room: Room<unknown, TownState>,
    private readonly w: WorldContext,
    shooting: Awaited<ReturnType<typeof setupCombat>>,
    views: PlayerViews,
    vehicles: VehicleViews,
  ) {
    this.shooting = shooting;
    this.views = views;
    this.vehicles = vehicles;
    this.npcs = new NpcViews(
      w.scene,
      { 'character-male': w.templates.male, 'character-female': w.templates.female },
      w.templates.male,
    );
    this.input = inputChannel(room);
    this.predict = Predict.get(room, { mode: 'lerp', delay: INTERPOLATION_MS });
    this.predict.attachAll('players', { fields: ['x', 'y', 'z'], snap: SNAP_M });
    this.predict.attachAll('npcs', { fields: ['x', 'z'], snap: SNAP_M });
    this.predict.attachAll('vehicles', {
      fields: ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'],
      snap: SNAP_M,
    });
  }

  static async start(room: Room<unknown, TownState>, w: WorldContext): Promise<Session> {
    const vehicles = new VehicleViews(w.scene, w.loader, w.vehicles);
    const views = new PlayerViews(
      w.scene,
      w.templates.male,
      (id) => vehicles.seat(id),
      w.templates.guns,
    );
    const shooting = await setupCombat({
      room,
      scene: w.scene,
      town: w.town,
      catalog: w.weapons,
      loader: w.loader,
      views,
      physics: w.physics,
      orbit: w.orbit,
    });
    const s = new Session(room, w, shooting, views, vehicles);
    s.wire();
    return s;
  }

  private wire(): void {
    const { room, w } = this;
    const cb = Callbacks.get(room);
    cb.onAdd('npcs', (n, id) => {
      this.npcs.upsert(id, n);
      cb.onChange(n, () => this.npcs.upsert(id, n));
    });
    cb.onRemove('npcs', (_n, id) => this.npcs.remove(id));
    cb.onAdd('players', (p, id) => {
      this.views.upsert(id, p);
      if (id === room.sessionId) this.predictLocal(p);
      cb.onChange(p, () => {
        this.views.upsert(id, p);
        if (id === room.sessionId) this.shooting.combat.reconcile(p);
      });
    });
    cb.onRemove('players', (_p, id) => this.views.remove(id));
    cb.onAdd('vehicles', (v, id) => {
      void this.vehicles.upsert(id, v);
      cb.onChange(v, () => void this.vehicles.upsert(id, v));
    });
    cb.onRemove('vehicles', (_v, id) => {
      this.vehicles.remove(id);
      w.spaces.dropVehicle(id);
    });
    room.onMessage(ServerMsg.Stats, (s: ServerStats) => (this.stats = s));
    room.onMessage(ServerMsg.Handoff, (m: { reservation: unknown }) =>
      this.onHandoff?.(m.reservation),
    );
    this.timers.push(setInterval(() => room.ping((ms) => (this.pingMs = ms)), 1000));
    installTestHook({
      room,
      seq: () => this.seq,
      views: this.views,
      streamer: w.streamer,
      spaces: w.spaces,
      hud: w.hud,
      vehicles: this.vehicles,
      combat: this.shooting.combat,
      props: this.shooting.props,
      npcs: this.npcs,
      orbit: w.orbit,
    });
  }

  /** The local player: predicted with the shared motor, reconciled against the server. */
  private predictLocal(p: PlayerState): void {
    const motor = this.w.physics.motor;
    motor.add(ME, p);
    this.reconciler = this.predict.reconciler(p, {
      input: this.input,
      fields: ['x', 'y', 'z', 'yaw', 'vy'],
      snap: SNAP_M,
      smoothMs: 60,
      step: (ctx, state, cmd) => {
        // Only on foot, alive and in a loaded space is movement ours to predict; otherwise the
        // server alone moves us (seats, respawns, doors) and reconciliation adopts it.
        if (p.vehicle || p.health === 0 || p.space !== this.w.spaces.current) return;
        motor.place(ME, state);
        motor.move(ME, state, cmd as InputFrame, ctx.dt);
      },
    }) as unknown as { state: PlayerState };
  }

  /** Once per rendered frame: send due inputs, then draw everything at its predicted/interpolated pose. */
  frame(dt: number, now: number): void {
    const { room, w, predict } = this;
    const due = predict.tick(now);
    const stepS = this.input.stepSeconds ?? 0.05;
    for (let i = 0; i < due; i++) {
      const keys = w.keyboard.sample();
      Object.assign(this.input.data, {
        seq: ++this.seq,
        dt: stepS,
        keys,
        yaw: w.orbit.yaw,
        pitch: w.orbit.pitch,
      });
      this.input.send();
      // After sending: the shot uses this frame's aim, recoil lands on the next one.
      this.shooting.combat.step(keys, stepS, room.state.players.get(room.sessionId));
    }

    const players = room.state.players;
    this.vehicles.render(dt, w.spaces.current === TOWN_SPACE, (id) => {
      const v = room.state.vehicles.get(id);
      if (!v) return undefined;
      const f = (k: 'x' | 'y' | 'z' | 'qx' | 'qy' | 'qz' | 'qw') => predict.value(v, k);
      return {
        x: f('x'),
        y: f('y'),
        z: f('z'),
        qx: f('qx'),
        qy: f('qy'),
        qz: f('qz'),
        qw: f('qw'),
      };
    });
    this.views.render(dt, w.spaces.current, (id) => {
      const p = players.get(id);
      return p ? [predict.value(p, 'x'), predict.value(p, 'y'), predict.value(p, 'z')] : undefined;
    });
    w.spaces.syncVehicles(this.vehicles.entries());
  }

  /** Pedestrians are drawn after the camera focus is known (they cull by distance to it). */
  renderNpcs(dt: number, focus: THREE.Vector3): void {
    const { room, predict, w } = this;
    this.npcs.render(dt, focus, w.spaces.current === TOWN_SPACE, (id) => {
      const n = room.state.npcs.get(id);
      return n ? [predict.value(n, 'x'), predict.value(n, 'z')] : undefined;
    });
    this.shooting.render(dt);
  }

  get me(): PlayerState | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timers.forEach(clearInterval);
    this.predict.dispose();
    this.w.physics.motor.remove(ME);
    for (const [id] of [...this.vehicles.entries()]) this.w.spaces.dropVehicle(id);
    this.views.dispose();
    this.vehicles.dispose();
    this.npcs.dispose();
    this.shooting.dispose();
  }
}

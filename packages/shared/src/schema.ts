import { schema, t, type SchemaType } from '@colyseus/schema';
import { PLAYER } from './constants.js';

// Every field has a default: an undefined number here becomes NaN in the simulation.

/** Everything the server owns is in here; anything cosmetic stays on the client. */
export const PlayerState = schema(
  {
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    vy: t.float32().default(0),
    health: t.uint8().default(PLAYER.maxHealth),
    /** Last input seq the server applied — clients reconcile against this. */
    lastSeq: t.uint32().default(0),
    /** 'town' or the id of the interior the player is inside. */
    space: t.string().default('town'),
    /** Vehicle entity id when driving, '' on foot. */
    vehicle: t.string().default(''),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** A server-owned vehicle. The driver's inputs are relayed; physics runs only on the server. */
export const VehicleState = schema(
  {
    kind: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    qx: t.float32().default(0),
    qy: t.float32().default(0),
    qz: t.float32().default(0),
    qw: t.float32().default(1),
    /** Front-wheel angle (rad) and forward speed (m/s): cosmetic inputs for wheels and lean. */
    steer: t.float32().default(0),
    speed: t.float32().default(0),
    /** Session id of the driver, '' when parked. */
    driver: t.string().default(''),
  },
  'VehicleState',
);
export type VehicleState = SchemaType<typeof VehicleState>;

export const TownState = schema(
  {
    tick: t.uint32().default(0),
    players: t.map(PlayerState),
    vehicles: t.map(VehicleState),
  },
  'TownState',
);
export type TownState = SchemaType<typeof TownState>;

/**
 * Client → server input frame. Flat (primitives only) so Colyseus's input channel can
 * encode it; the server consumes one per fixed step and acks `seq` for reconciliation.
 */
export const InputSchema = schema(
  {
    seq: t.uint32().default(0),
    dt: t.float32().default(0),
    keys: t.uint16().default(0),
    yaw: t.float32().default(0),
    pitch: t.float32().default(0),
  },
  'InputSchema',
);
export type InputSchema = SchemaType<typeof InputSchema>;

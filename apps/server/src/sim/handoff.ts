import { randomBytes } from 'node:crypto';
import type { Presence } from 'colyseus';
import type { Arsenal } from '@town/shared';
import type { VehicleTransfer } from './vehicles.js';

/** What crosses a zone border with a player. Stored server-side; the client only carries a token. */
export interface HandoffPayload {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  arsenal?: Arsenal;
  vehicle?: VehicleTransfer;
}

const TTL_S = 30;
const key = (token: string) => `handoff:${token}`;

/**
 * Park a player's state in presence (Redis when scaled out, so any process can pick it up) under a
 * random one-time token. The token rides in the target room's join options; it can't be forged
 * into someone else's state and can only be claimed once.
 */
export async function park(presence: Presence, payload: HandoffPayload): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await presence.setex(key(token), JSON.stringify(payload), TTL_S);
  return token;
}

export async function claim(
  presence: Presence,
  token: unknown,
): Promise<HandoffPayload | undefined> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return undefined;
  const raw = await presence.get(key(token));
  if (!raw) return undefined;
  await presence.del(key(token));
  return JSON.parse(raw) as HandoffPayload;
}

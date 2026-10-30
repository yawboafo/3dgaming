import { matchMaker, type Client, type Presence } from 'colyseus';
import {
  ROOM_TOWN,
  ServerMsg,
  TOWN_SPACE,
  inZone,
  zoneAt,
  type PlayerState,
  type ZoneBounds,
} from '@town/shared';
import { park, type HandoffPayload } from '../sim/handoff.js';

/** Players must be this far past the edge before they're handed off (no flapping on the line). */
const MARGIN_M = 3;
/** If the client hasn't moved rooms by then, give the player back to this room. */
const TIMEOUT_MS = 10_000;
/** Interiors and in-flight hand-offs use pseudo-spaces outside the town. */
export const HANDOFF_SPACE = 'handoff';

export interface BorderHooks {
  presence: Presence;
  client(sid: string): Client | undefined;
  /** Snapshot the player (and remove their vehicle from this room if driving). */
  pack(sid: string, p: PlayerState): HandoffPayload;
  /** The hand-off failed or timed out: make the player (and their vehicle) normal again here. */
  restore(sid: string, p: PlayerState, payload: HandoffPayload): void;
}

/**
 * Hands players to the neighbouring zone's room when they cross this zone's border. The player's
 * state goes into presence (Redis when scaled out); a seat is reserved in the target room through
 * the matchmaker, which may live in another process; the client gets the reservation and moves.
 */
export class ZoneBorder {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    readonly zone: string,
    readonly bounds: ZoneBounds,
    private readonly hooks: BorderHooks,
  ) {}

  /** Call a couple of times a second. */
  check(players: Iterable<[string, PlayerState]>): void {
    for (const [sid, p] of players) {
      if (this.pending.has(sid) || p.space !== TOWN_SPACE || p.health === 0) continue;
      if (inZone(this.bounds, p.x, p.z, MARGIN_M)) continue;
      const target = zoneAt(p.x, p.z);
      if (target === this.zone || !/^zone_\d+_\d+$/.test(target)) continue;
      void this.handOff(sid, p, target);
    }
  }

  busy(sid: string): boolean {
    return this.pending.has(sid);
  }

  /** The player left this room (normally: they took the seat next door). */
  forget(sid: string): void {
    clearTimeout(this.pending.get(sid));
    this.pending.delete(sid);
  }

  private async handOff(sid: string, p: PlayerState, target: string): Promise<void> {
    const client = this.hooks.client(sid);
    if (!client) return;
    const payload = this.hooks.pack(sid, p);
    p.space = HANDOFF_SPACE; // hidden and frozen here until the client leaves
    this.pending.set(
      sid,
      setTimeout(() => {
        this.pending.delete(sid);
        this.hooks.restore(sid, p, payload);
      }, TIMEOUT_MS),
    );
    try {
      const handoff = await park(this.hooks.presence, payload);
      const reservation = await matchMaker.joinOrCreate(ROOM_TOWN, {
        zone: target,
        handoff,
        name: payload.name,
      });
      client.send(ServerMsg.Handoff, { reservation });
    } catch (err) {
      console.error(`[zone ${this.zone}] hand-off of ${sid} to ${target} failed`, err);
      this.forget(sid);
      this.hooks.restore(sid, p, payload);
    }
  }
}

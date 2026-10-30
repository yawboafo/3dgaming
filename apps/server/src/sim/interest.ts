import { StateView } from '@colyseus/schema';
import { CHUNK_SIZE, INTEREST_RADIUS, type TownState, type WorldDef } from '@town/shared';
import type { Client } from 'colyseus';

type Ref = Parameters<StateView['add']>[0];

/** Props don't move; their positions come from town.json. */
type PropPositions = Map<string, [number, number]>;

const RADIUS = INTEREST_RADIUS * CHUNK_SIZE;
/** Hysteresis so entities on the edge don't flicker in and out. */
const KEEP = RADIUS + 16;

/**
 * Interest management: every client gets a StateView holding only entities within
 * INTEREST_RADIUS chunks of its own player (always including itself). Run a few times a second.
 */
export class InterestManager {
  private readonly props: PropPositions = new Map();

  constructor(
    private readonly state: TownState,
    town: WorldDef,
  ) {
    town.destructibles.forEach((d, i) => this.props.set(`d.${i}`, [d.pos[0], d.pos[2]]));
  }

  join(client: Client): void {
    client.view = new StateView();
    const me = this.state.players.get(client.sessionId);
    if (me) client.view.add(me);
  }

  update(clients: Iterable<Client>): void {
    for (const client of clients) {
      const view = client.view;
      const me = this.state.players.get(client.sessionId);
      if (!view || !me) continue;
      const cx = me.x;
      const cz = me.z;
      const consider = (obj: Ref, x: number, z: number, alwaysIn = false) => {
        const d = Math.hypot(x - cx, z - cz);
        const has = view.has(obj);
        if (alwaysIn || (!has && d <= RADIUS)) {
          if (!has) view.add(obj);
        } else if (has && d > KEEP) view.remove(obj);
      };
      for (const [sid, p] of this.state.players) {
        // Interiors are 2 km away, so distance already separates spaces.
        consider(p, p.x, p.z, sid === client.sessionId);
      }
      for (const n of this.state.npcs.values()) consider(n, n.x, n.z);
      for (const v of this.state.vehicles.values()) consider(v, v.x, v.z);
      for (const pr of this.state.projectiles.values()) consider(pr, pr.x, pr.z);
      for (const [id, prop] of this.state.props) {
        const at = this.props.get(id);
        if (at) consider(prop, at[0], at[1]);
      }
    }
  }
}

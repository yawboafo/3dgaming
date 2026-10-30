import { Client, type Room } from '@colyseus/sdk';
import { InputSchema, ROOM_TOWN, TownState, worldToChunk, zoneOf } from '@town/shared';

/**
 * Single-player and multiplayer share this path: "single-player" is just a room on a
 * server running locally (pnpm dev starts one).
 */
export function serverUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  return fromQuery ?? import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
}

let client: Client | undefined;
const connection = () => (client ??= new Client(serverUrl()));

/** Join the zone room that owns this point (one room per 2×2 chunk block). */
export async function joinZoneAt(
  x: number,
  z: number,
  name: string,
): Promise<Room<unknown, TownState>> {
  const zone = zoneOf(worldToChunk(x, z));
  return connection().joinOrCreate(ROOM_TOWN, { name, zone }, TownState);
}

/** Take the seat the old zone reserved for us in the new one (state travels server-side). */
export async function consumeHandoff(reservation: unknown): Promise<Room<unknown, TownState>> {
  return connection().consumeSeatReservation(
    reservation as Parameters<Client['consumeSeatReservation']>[0],
    TownState,
  );
}

/** WebSocket has no datagram channel; switch to 'unreliable' with @colyseus/h3-transport later. */
export function inputChannel(room: Room<unknown, TownState>) {
  return room.input({ type: InputSchema, mode: 'reliable' });
}

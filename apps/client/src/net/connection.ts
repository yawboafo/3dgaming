import { Client, type Room } from '@colyseus/sdk';
import { InputSchema, ROOM_TOWN, TownState } from '@town/shared';

/**
 * Single-player and multiplayer share this path: "single-player" is just a room on a
 * server running locally (pnpm dev starts one).
 */
export function serverUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  return fromQuery ?? import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
}

export async function joinTown(name: string): Promise<Room<unknown, TownState>> {
  const client = new Client(serverUrl());
  return client.joinOrCreate(ROOM_TOWN, { name }, TownState);
}

/** WebSocket has no datagram channel; switch to 'unreliable' with @colyseus/h3-transport later. */
export function inputChannel(room: Room<unknown, TownState>) {
  return room.input({ type: InputSchema, mode: 'reliable' });
}

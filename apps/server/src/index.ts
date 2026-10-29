import {
  RedisDriver,
  RedisPresence,
  WebSocketTransport,
  defineRoom,
  defineServer,
  listen,
} from 'colyseus';
import { ROOM_TOWN } from '@town/shared';
import { TownRoom } from './rooms/TownRoom.js';

const port = Number(process.env.PORT ?? 2567);
const redisUrl = process.env.REDIS_URL;

/** With REDIS_URL set, rooms spread across processes/machines; without it, everything is in-process. */
const scaling = redisUrl
  ? { presence: new RedisPresence(redisUrl), driver: new RedisDriver(redisUrl) }
  : {};

const server = defineServer({
  ...scaling,
  transport: new WebSocketTransport(),
  rooms: {
    [ROOM_TOWN]: defineRoom(TownRoom),
  },
});

await listen(server, port);
console.log(`[server] listening on :${port}${redisUrl ? ' (redis scaling on)' : ''}`);

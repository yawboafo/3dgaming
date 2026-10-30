#!/usr/bin/env node
// Zone hand-off check, single- or multi-process.
//   node scripts/zone-handoff-check.mjs --a ws://localhost:2601 --b ws://localhost:2602 [--cross-process]
// Client B opens zone_2_1 on server B. Client A joins zone_1_1 through server A and sprints east
// across x = 256. A must be handed to the same zone_2_1 room B is in, with its state intact. With
// --cross-process (two servers sharing Redis), the seat must be served by B's process.
import { Client } from '@colyseus/sdk';

const arg = (n, d) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d;
const A = arg('a', 'ws://localhost:2567');
const B = arg('b', A);
const cross = process.argv.includes('--cross-process');
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const quiet = (r) => {
  r.onMessage('stats', () => {});
  r.onMessage('shot', () => {});
};

const b = await new Client(B).joinOrCreate('town', { name: 'B', zone: 'zone_2_1' });
quiet(b);
const clientA = new Client(A);
const a = await clientA.joinOrCreate('town', { name: 'A', zone: 'zone_1_1' });
let processA;
a.onMessage('stats', (s) => (processA ??= s.processId));
a.onMessage('shot', () => {});
let reservation;
a.onMessage('handoff', (m) => (reservation = m.reservation));
await new Promise((r) => setTimeout(r, 1200));

const meA = a.state.players.get(a.sessionId);
const input = a.input({ mode: 'reliable' });
let seq = 0;
const send = async (keys, yaw = 0, pitch = 0.4) => {
  Object.assign(input.data, { seq: ++seq, dt: 0.05, keys, yaw, pitch });
  input.send();
  await new Promise((r) => setTimeout(r, 50));
};
await send(64); // one shot so the ammo count is distinctive
for (let i = 0; i < 8; i++) await send(0);
const magBefore = meA.mag;
const t0 = Date.now();
while (!reservation && Date.now() - t0 < 30000) await send(8 | 16); // Right + Sprint (pedestrians can block)
if (!reservation) fail(`no hand-off after 30 s (x = ${meA.x.toFixed(1)})`);
console.log(
  `hand-off offered after ${((Date.now() - t0) / 1000).toFixed(1)} s at x = ${meA.x.toFixed(1)}`,
);
console.log(
  `  reservation → room ${reservation.roomId}, process ${reservation.processId ?? '?'}, address ${reservation.publicAddress ?? '(same)'}`,
);

const next = await clientA.consumeSeatReservation(reservation);
quiet(next);
await a.leave();
await new Promise((r) => setTimeout(r, 1200));
const me = next.state.players.get(next.sessionId);
if (next.roomId !== b.roomId)
  fail(`handed to room ${next.roomId}, expected B's zone_2_1 room ${b.roomId}`);
if (!me || me.x < 256) fail(`player missing or not across the border in the new room (${me?.x})`);
if (me.mag !== magBefore) fail(`ammo not carried over: ${me.mag} vs ${magBefore}`);
if (!b.state.players.has(next.sessionId)) fail('B cannot see A in the shared zone room');
if (cross && (!processA || reservation.processId === processA))
  fail(
    `expected zone_2_1 on another process than zone_1_1 (${processA} vs ${reservation.processId})`,
  );
if (cross) console.log(`  crossed processes: ${processA} → ${reservation.processId}`);
console.log(
  `✓ A is in B's room ${b.roomId} at x = ${me.x.toFixed(1)} with ${me.mag} rounds; B can see A`,
);
process.exit(0);

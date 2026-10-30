#!/usr/bin/env node
// 32-player load test: bots join the spawn zone, wander, sprint, shoot and follow zone hand-offs.
//   pnpm loadtest [-- --url ws://localhost:2567 --bots 32 --seconds 60]
// Prints per-zone tick and physics p95/max from the rooms' own stats, and per-bot bandwidth.
import { Client } from '@colyseus/sdk';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL = arg('url', 'ws://localhost:2567');
const BOTS = Number(arg('bots', 32));
const SECONDS = Number(arg('seconds', 60));
const TICK_MS = 50;
const Key = { Forward: 1, Back: 2, Left: 4, Right: 8, Sprint: 16, Fire: 64 };

const zones = new Map(); // zone -> { tick: number[], phys: number[], physMax: number[], players: number }
let handoffs = 0;
let errors = 0;

function watchBytes(room, bot) {
  const ev = room.connection.events;
  const orig = ev.onmessage;
  ev.onmessage = (e) => {
    const d = e.data;
    bot.bytes += d?.byteLength ?? d?.length ?? 0;
    return orig?.call(ev, e);
  };
}

async function runBot(i, client) {
  const bot = { bytes: 0, seq: 0, yaw: Math.random() * Math.PI * 2, keys: Key.Forward };
  let room = await client.joinOrCreate('town', { name: `bot${i}`, zone: 'zone_1_1' });
  const attach = (r) => {
    watchBytes(r, bot);
    r.onMessage('shot', () => {});
    r.onMessage('stats', (s) => {
      if (i % 4 !== 0) return; // a few reporters are enough
      const z = zones.get(s.zone) ?? { tick: [], phys: [], physMax: [], players: 0 };
      z.tick.push(s.tickMs);
      z.phys.push(s.physicsStepMs);
      z.physMax.push(s.physicsStepMaxMs);
      z.players = Math.max(z.players, s.players);
      zones.set(s.zone, z);
    });
    r.onMessage('handoff', async ({ reservation }) => {
      try {
        const next = await client.consumeSeatReservation(reservation);
        const old = room;
        room = next;
        input = room.input({ mode: 'reliable' });
        attach(room);
        await old.leave();
        handoffs++;
      } catch {
        errors++;
      }
    });
  };
  attach(room);
  let input = room.input({ mode: 'reliable' });
  const end = Date.now() + SECONDS * 1000;
  let t = 0;
  while (Date.now() < end) {
    t++;
    if (t % 40 === 0) {
      // New heading and gait every 2 s; mostly walking, sometimes sprinting.
      bot.yaw += (Math.random() - 0.5) * 2.5;
      bot.keys = Key.Forward | (Math.random() < 0.35 ? Key.Sprint : 0);
    }
    const fire = t % 60 === i % 60 ? Key.Fire : 0;
    Object.assign(input.data, {
      seq: ++bot.seq,
      dt: 0.05,
      keys: bot.keys | fire,
      yaw: bot.yaw,
      pitch: -0.05,
    });
    input.send();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await room.leave();
  return bot.bytes;
}

const p = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0;
};

console.log(`[load] ${BOTS} bots → ${URL} for ${SECONDS} s`);
const client = new Client(URL);
const started = Date.now();
const bots = [];
for (let i = 0; i < BOTS; i++) {
  bots.push(runBot(i, client).catch((e) => (errors++, console.error(`[bot ${i}]`, e.message), 0)));
  await new Promise((r) => setTimeout(r, 60)); // stagger joins
}
const bytes = await Promise.all(bots);
const secs = (Date.now() - started) / 1000;
const kbps = bytes.map((b) => (b * 8) / 1000 / secs);

console.log(
  '\nzone        players  tick p95  tick max  phys p95  phys max   (ms, from per-second reports)',
);
for (const [zone, z] of [...zones].sort()) {
  console.log(
    `${zone.padEnd(11)} ${String(z.players).padStart(7)}  ${p(z.tick, 0.95).toFixed(2).padStart(8)}  ${Math.max(
      ...z.tick,
    )
      .toFixed(2)
      .padStart(8)}  ${p(z.phys, 0.95).toFixed(2).padStart(8)}  ${Math.max(...z.physMax)
      .toFixed(2)
      .padStart(8)}`,
  );
}
console.log(
  `\nbandwidth per bot (downstream): avg ${(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(1)} kbit/s, max ${Math.max(...kbps).toFixed(1)} kbit/s`,
);
console.log(`hand-offs: ${handoffs}, errors: ${errors}`);
const worst = Math.max(0, ...[...zones.values()].map((z) => p(z.tick, 0.95)));
const budget = 1000 / 20;
console.log(`verdict: worst zone tick p95 ${worst.toFixed(2)} ms of a ${budget} ms tick budget`);
process.exit(errors > 0 ? 1 : 0);

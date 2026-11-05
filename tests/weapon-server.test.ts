import { beforeAll, afterAll, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOVEMENT_PROTOCOL } from '../shared/game.js';
import type { MatchState } from '../server/state.js';
let server: ChildProcess, shotId = 0, serverLog = '';
const port = 26702, rooms: Room<MatchState>[] = [];
async function wait(test: () => boolean, ms = 4000) { const end = Date.now() + ms; while (!test() && Date.now() < end) await delay(20); expect(test()).toBe(true); }
const human = (r: Room<MatchState>) => r.state.players.get(r.sessionId)!;
const shot = (r: Room<MatchState>) => ({ shotId: ++shotId, seq: human(r).ack, yaw: 0, pitch: 0 });
async function open(type = 'practice') { const r = await new Client(`ws://localhost:${port}`).create<MatchState>(type, { protocol: MOVEMENT_PROTOCOL }); rooms.push(r); r.onMessage('*', () => {}); await wait(() => !!r.state.players?.get(r.sessionId)); return r; }
async function select(r: Room<MatchState>, id: string) { r.send('weapon:select', id); await wait(() => human(r).weapon === id); }
function trigger(r: Room<MatchState>, action: string) { r.send('weapon:trigger', { action, shot: shot(r) }); }
async function hold(r: Room<MatchState>, ms: number) { trigger(r, 'start'); const timer = setInterval(() => trigger(r, 'aim'), 80); try { await delay(ms); } finally { clearInterval(timer); } }
beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/weapon-server.ts'], { env: { ...process.env, PORT: String(port), PCB_TEST_WEAPON_PICKUP_SECONDS: '.3', PCB_TEST_DROP_SECONDS: '2' }, stdio: 'pipe' });
  server.stderr?.on('data', chunk => serverLog += String(chunk));
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {} await delay(100); }
  throw new Error(`Weapon test server failed: ${serverLog}`);
}, 30000);
afterAll(async () => { for (const r of rooms) await r.leave(); server.kill(); });
it('rejects multiplayer weapon selection before pickups', async () => {
  const r = await open('pcb'); r.send('weapon:select', 'iron'); r.send('weapon:select', '__proto__'); trigger(r, 'start');
  await delay(120); expect(human(r).weapon).toBe('solder'); expect(human(r).ammo).toBe(30); expect(human(r).chargeStarted).toBe(0);
});
it('measures charge on the server and cannot kill a full health NPC with a full iron hold', async () => {
  const r = await open(); await select(r, 'iron');
  const feeds: string[] = []; r.onMessage('feed', (m: { text: string }) => feeds.push(m.text));
  trigger(r, 'release'); r.send('shoot', { ...shot(r), charge: 100 });
  await delay(100); expect(human(r).ammo).toBe(5);
  await hold(r, 1100); trigger(r, 'release');
  await wait(() => r.state.players.get('npc-0')!.hp === 10);
  expect(human(r).ammo).toBe(4); expect(human(r).chargeStarted).toBe(0);
  expect(r.state.players.get('npc-0')!.alive).toBe(true);
  expect(feeds).toHaveLength(0);
  trigger(r, 'release'); await delay(100); expect(human(r).ammo).toBe(4);
});
it('aggregates eight pump pellets and preserves ammo/cooldown across switching and reload cancellation', async () => {
  const r = await open(); await select(r, 'pump'); r.send('shoot', shot(r)); r.send('shoot', shot(r));
  await wait(() => human(r).ammo === 5); expect(r.state.players.get('npc-0')!.hp).toBe(4);
  await select(r, 'solder'); r.send('shoot', shot(r)); await delay(80); expect(human(r).ammo).toBe(30);
  await select(r, 'pump'); expect(human(r).ammo).toBe(5);
  r.send('reload'); await wait(() => human(r).reloading); await select(r, 'iron'); expect(human(r).reloading).toBe(false);
  await select(r, 'pump'); expect(human(r).ammo).toBe(5);
  r.send('reload'); await wait(() => human(r).ammo === 6 && !human(r).reloading, 3000); expect(human(r).reserve).toBe(35);
});
it('fires sniper instantly for 100, automatically recharges and cannot bypass recharge by switching', async () => {
  const r = await open(); await select(r, 'sniper');
  r.send('weapon:ads', true); await wait(() => human(r).ads);
  const damage: number[] = []; r.onMessage('damage', (m: { amount: number }) => damage.push(m.amount));
  r.send('shoot', shot(r));
  await wait(() => human(r).reloading);
  expect(human(r).ammo).toBe(0); expect(human(r).ads).toBe(false);
  expect(r.state.players.get('npc-0')!.alive).toBe(false); expect(damage).toContain(100);
  const deadline = human(r).sniperReloadAt;
  for (let i = 0; i < 3; i++) {
    await select(r, 'solder'); await select(r, 'sniper');
    r.send('shoot', shot(r)); await delay(50);
    expect(human(r).ammo).toBe(0); expect(human(r).sniperReloadAt).toBe(deadline);
  }
  await select(r, 'solder'); await wait(() => human(r).sniperReloadAt === 0, 3000);
  await select(r, 'sniper'); expect(human(r).ammo).toBe(1); expect(human(r).reloading).toBe(false);
  r.send('shoot', shot(r)); await wait(() => human(r).ammo === 0);
  await wait(() => human(r).ammo === 1 && !human(r).reloading, 3000);
}, 10000);
it('pulses hot air server-side, damages NPCs, overheats and cools in about two seconds', async () => {
  const r = await open(); await select(r, 'air'); trigger(r, 'start');
  const timer = setInterval(() => trigger(r, 'aim'), 80), start = Date.now();
  try { await wait(() => human(r).overheated, 5000); } finally { clearInterval(timer); }
  expect(Date.now() - start).toBeGreaterThan(2800); expect(human(r).heat).toBeGreaterThan(.85);
  expect(human(r).kills).toBeGreaterThan(0); expect(human(r).ammo).toBe(0);
  trigger(r, 'cancel'); await wait(() => !human(r).overheated && human(r).heat === 0, 2600);
});
it('cancels stale charges, reload charges and switch charges without ammo grants', async () => {
  const r = await open(); await select(r, 'iron'); trigger(r, 'start'); await wait(() => human(r).chargeStarted > 0);
  await wait(() => human(r).chargeStarted === 0, 1000); expect(human(r).ammo).toBe(5);
  trigger(r, 'start'); await wait(() => human(r).chargeStarted > 0); r.send('reload'); await wait(() => human(r).chargeStarted === 0);
  trigger(r, 'start'); await wait(() => human(r).chargeStarted > 0); await select(r, 'pump'); expect(human(r).chargeStarted).toBe(0);
  await select(r, 'iron'); expect(human(r).ammo).toBe(5);
});
it('clears held charge and restores default inventory on real falling death and respawn', async () => {
  const r = await open(); await select(r, 'iron'); trigger(r, 'start');
  const timer = setInterval(() => trigger(r, 'aim'), 80);
  try {
    for (let seq = 1; seq <= 200; seq++) r.send('input', { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: true });
    await wait(() => !human(r).alive); expect(human(r).chargeStarted).toBe(0);
    await wait(() => human(r).alive, 3500); expect(human(r).weapon).toBe('solder'); expect(human(r).specialWeapon).toBe('');
    expect(human(r).ammo).toBe(30); expect(human(r).triggerHeld).toBe(false); expect(human(r).heat).toBe(0);
  } finally { clearInterval(timer); }
}, 12000);
it('validates multiplayer pickup versions/distance, carries one special, preserves primary ammo and resets on death', async () => {
  const r = await open('pcb'); const peer = await new Client(`ws://localhost:${port}`).joinById<MatchState>(r.roomId, { protocol: MOVEMENT_PROTOCOL }); rooms.push(peer);
  await wait(() => r.state.phase === 'playing' && r.state.weaponPickups?.size === 11);
  const p = human(r);
  expect([...r.state.weaponPickups.values()].filter(p => p.weapon === 'iron')).toHaveLength(3);
  expect([...r.state.weaponPickups.values()].filter(p => p.weapon === 'air')).toHaveLength(3);
  expect([...r.state.weaponPickups.values()].filter(p => p.weapon === 'pump')).toHaveLength(3);
  expect(r.state.practice).toBe(false); expect(p.specialWeapon).toBe('');
  r.send('weapon:select', 'pump'); r.send('weapon:collect', { id: '2', version: 0 }); r.send('weapon:collect', { id: 'bogus', version: 0 });
  await delay(100); expect(p.weapon).toBe('solder'); expect(p.specialWeapon).toBe('');
  const collect = (id: string, version = r.state.weaponPickups.get(id)!.version) => r.send('weapon:collect', { id, version });
  collect('0'); collect('0'); await wait(() => p.specialWeapon === 'iron'); expect(p.weapon).toBe('iron');
  expect(r.state.weaponPickups.get('0')!.version).toBe(2);
  r.send('weapon:swap'); await wait(() => p.weapon === 'solder'); expect(p.specialWeapon).toBe('iron');
  r.send('shoot', shot(r)); await wait(() => p.ammo === 29);
  r.send('weapon:swap'); await wait(() => p.weapon === 'iron'); expect(p.ammo).toBe(5);
  collect('1'); await wait(() => p.specialWeapon === 'air'); expect(p.weapon).toBe('air');
  r.send('weapon:select', 'iron'); await delay(100); expect(p.weapon).toBe('air');
  await wait(() => r.state.weaponPickups.get('0')!.active); collect('0', 0); await delay(80); expect(p.specialWeapon).toBe('air');
  collect('0'); await wait(() => p.specialWeapon === 'iron');
  r.send('weapon:swap'); await wait(() => p.weapon === 'solder'); expect(p.ammo).toBe(29);
  for (let seq = 1; seq <= 200; seq++) r.send('input', { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: true });
  await wait(() => !p.alive); collect('1'); await delay(100); expect(p.specialWeapon).toBe('iron');
  await wait(() => p.alive, 3500); expect(p.weapon).toBe('solder'); expect(p.specialWeapon).toBe('');
}, 14000);
it('drops replacement stock once, blocks the owner briefly, lets peers collect, and expires temporary pickups', async () => {
  const r = await open('pcb'), peer = await new Client(`ws://localhost:${port}`).joinById<MatchState>(r.roomId, { protocol: MOVEMENT_PROTOCOL }); rooms.push(peer); peer.onMessage('*', () => {});
  await wait(() => r.state.phase === 'playing' && !!peer.state.players?.get(peer.sessionId));
  const collect = (client: Room<MatchState>, id: string) => client.send('weapon:collect', { id, version: r.state.weaponPickups.get(id)?.version ?? 0 });
  collect(r, '0'); await wait(() => human(r).weapon === 'iron');
  trigger(r, 'start'); trigger(r, 'release'); await wait(() => human(r).ammo === 4);
  collect(r, '1'); collect(r, '1'); await wait(() => human(r).weapon === 'air');
  const drops = () => [...r.state.weaponPickups.entries()].filter(([, p]) => p.dropped);
  await wait(() => drops().length === 1); const id = drops()[0][0];
  collect(r, id); await delay(80); expect(human(r).weapon).toBe('air'); expect(drops()).toHaveLength(1);
  collect(peer, id); collect(peer, id); await wait(() => human(peer).weapon === 'iron');
  expect(human(peer).ammo).toBe(4); expect(human(peer).specialWeapon).toBe('iron');
  await wait(() => !r.state.weaponPickups.has(id));
  await wait(() => r.state.weaponPickups.get('0')!.active); collect(r, '0'); await wait(() => human(r).weapon === 'iron');
  await wait(() => drops().length === 1); const expired = drops()[0][0];
  await wait(() => !r.state.weaponPickups.has(expired), 3000);
  await delay(400); expect(r.state.weaponPickups.has(expired)).toBe(false);
}, 10000);
it('transfers an in-progress capacitor recharge without restarting it or granting ammo', async () => {
  const r = await open('pcb'), peer = await new Client(`ws://localhost:${port}`).joinById<MatchState>(r.roomId, { protocol: MOVEMENT_PROTOCOL }); rooms.push(peer); peer.onMessage('*', () => {});
  await wait(() => r.state.phase === 'playing' && !!peer.state.players?.get(peer.sessionId));
  for (let seq = 1; seq <= 6; seq++) peer.send('input', { seq, forward: 0, strafe: 1, yaw: 0, pitch: 0, jump: false, sprint: false });
  await wait(() => human(peer).ack === 6);
  r.send('weapon:collect', { id: '9', version: r.state.weaponPickups.get('9')!.version }); await wait(() => human(r).weapon === 'sniper');
  r.send('shoot', { ...shot(r), yaw: Math.PI }); await wait(() => human(r).reloading);
  const deadline = human(r).sniperReloadAt;
  r.send('weapon:collect', { id: '1', version: r.state.weaponPickups.get('1')!.version }); await wait(() => human(r).weapon === 'air');
  const drop = [...r.state.weaponPickups.entries()].find(([, p]) => p.dropped && p.weapon === 'sniper')!;
  peer.send('weapon:collect', { id: drop[0], version: drop[1].version }); await wait(() => human(peer).weapon === 'sniper');
  expect(human(peer).ammo).toBe(0); expect(human(peer).sniperReloadAt).toBe(deadline);
  await wait(() => human(peer).ammo === 1 && !human(peer).reloading, 3000);
}, 7000);
it('drops a carried special exactly once on an authoritative kill', async () => {
  const r = await open('pcb'), peer = await new Client(`ws://localhost:${port}`).joinById<MatchState>(r.roomId, { protocol: MOVEMENT_PROTOCOL }); rooms.push(peer); peer.onMessage('*', () => {});
  await wait(() => r.state.phase === 'playing' && !!peer.state.players?.get(peer.sessionId));
  peer.send('weapon:collect', { id: '0', version: r.state.weaponPickups.get('0')!.version }); await wait(() => human(peer).weapon === 'iron');
  for (let seq = 1; seq <= 24; seq++) peer.send('input', { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false });
  await wait(() => human(peer).ack === 24);
  r.send('weapon:collect', { id: '9', version: r.state.weaponPickups.get('9')!.version }); await wait(() => human(r).weapon === 'sniper');
  r.send('weapon:ads', true); r.send('shoot', shot(r));
  await wait(() => !human(peer).alive);
  const drops = [...r.state.weaponPickups.values()].filter(p => p.dropped);
  expect(drops).toHaveLength(1); expect(drops[0].weapon).toBe('iron');
  expect(Math.hypot(drops[0].x - human(peer).x, drops[0].z - human(peer).z)).toBeLessThanOrEqual(1.5);
  expect(human(peer).specialWeapon).toBe('');
  peer.send('weapon:collect', { id: '1', version: 0 }); await delay(100);
  expect([...r.state.weaponPickups.values()].filter(p => p.dropped)).toHaveLength(1);
}, 7000);
for (const weapon of ['solder', 'iron', 'air', 'pump', 'sniper']) it(`sends confirmed ${weapon} damage only to the attacker and victim`, async () => {
  const r = await open('pcb');
  const join = async () => { const peer = await new Client(`ws://localhost:${port}`).joinById<MatchState>(r.roomId, { protocol: MOVEMENT_PROTOCOL }); rooms.push(peer); peer.onMessage('*', () => {}); await wait(() => !!peer.state.players?.get(peer.sessionId)); return peer; };
  const victim = await join(), observer = await join();
  for (let seq = 1; seq <= 6; seq++) observer.send('input', { seq, forward: 0, strafe: 1, yaw: 0, pitch: 0, jump: false, sprint: false });
  await wait(() => human(observer).ack === 6);
  for (let seq = 1; seq <= 24; seq++) victim.send('input', { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false });
  await wait(() => human(victim).ack === 24);
  const damage: { shooter: string; target: string; amount: number; eliminated: boolean; side: string }[] = [], unrelated: unknown[] = [], eliminations: unknown[] = [], otherKills: unknown[] = [];
  r.onMessage('damage', m => damage.push(m)); observer.onMessage('damage', m => unrelated.push(m));
  r.onMessage('elimination', m => eliminations.push(m)); observer.onMessage('elimination', m => otherKills.push(m));
  if (weapon !== 'solder') { const id = ({ iron: '0', air: '1', pump: '2', sniper: '9' } as Record<string, string>)[weapon];
    // Fixture pickup 2 is deliberately distant; move to it only for this test.
    if (weapon === 'pump') { for (let seq = 1; seq <= 69; seq++) r.send('input', { seq, forward: 0, strafe: 1, yaw: 0, pitch: 0, jump: false, sprint: false }); await wait(() => human(r).ack === 69); }
    r.send('weapon:collect', { id, version: r.state.weaponPickups.get(id)!.version }); await wait(() => human(r).weapon === weapon);
    if (weapon === 'pump') { for (let seq = 70; seq <= 138; seq++) r.send('input', { seq, forward: 0, strafe: -1, yaw: 0, pitch: 0, jump: false, sprint: false }); await wait(() => human(r).ack === 138); }
  }
  const aim = () => ({ ...shot(r), yaw: Math.atan2(human(r).x - human(victim).x, human(r).z - human(victim).z) });
  if (weapon === 'iron') { r.send('weapon:trigger', { action: 'start', shot: aim() }); await delay(200); r.send('weapon:trigger', { action: 'release', shot: aim() }); }
  else if (weapon === 'air') r.send('weapon:trigger', { action: 'start', shot: aim() });
  else { if (weapon === 'sniper') r.send('weapon:ads', true); r.send('shoot', aim()); }
  await wait(() => damage.some(m => m.target === victim.sessionId));
  if (weapon === 'air') r.send('weapon:trigger', { action: 'cancel' });
  await delay(120);
  const hits = damage.filter(m => m.target === victim.sessionId);
  expect(hits.every(m => m.shooter === r.sessionId && m.side === 'front' && m.amount > 0)).toBe(true);
  expect(human(victim).hp).toBeCloseTo(Math.max(0, 100 - hits.reduce((sum, m) => sum + m.amount, 0)), 3);
  expect(unrelated).toHaveLength(0); expect(otherKills).toHaveLength(0);
  if (weapon === 'sniper') { expect(hits[0].amount).toBe(100); expect(hits[0].eliminated).toBe(true); expect(eliminations).toHaveLength(1); }
}, 10000);

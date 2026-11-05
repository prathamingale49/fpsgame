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
  server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/weapon-server.ts'], { env: { ...process.env, PORT: String(port), PCB_TEST_WEAPON_PICKUP_SECONDS: '.3' }, stdio: 'pipe' });
  server.stderr?.on('data', chunk => serverLog += String(chunk));
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {} await delay(100); }
  throw new Error(`Weapon test server failed: ${serverLog}`);
}, 30000);
afterAll(async () => { for (const r of rooms) await r.leave(); server.kill(); });
it('keeps multiplayer solder-only and rejects invalid selection/actions', async () => {
  const r = await open('pcb'); r.send('weapon:select', 'iron'); r.send('weapon:select', '__proto__'); trigger(r, 'start');
  await delay(120); expect(human(r).weapon).toBe('solder'); expect(human(r).ammo).toBe(30); expect(human(r).chargeStarted).toBe(0);
});
it('measures charge on the server and damages NPCs for 100 only after a full hold', async () => {
  const r = await open(); await select(r, 'iron');
  const feeds: string[] = []; r.onMessage('feed', (m: { text: string }) => feeds.push(m.text));
  trigger(r, 'start'); trigger(r, 'release'); r.send('shoot', { ...shot(r), charge: 100 });
  await delay(100); expect(human(r).ammo).toBe(5);
  await hold(r, 1100); trigger(r, 'release');
  await wait(() => !r.state.players.get('npc-0')!.alive);
  expect(human(r).ammo).toBe(4); expect(human(r).chargeStarted).toBe(0);
  expect(feeds.some(text => text.includes('precision-soldered'))).toBe(true);
  trigger(r, 'start'); trigger(r, 'release'); await delay(100); expect(human(r).ammo).toBe(4);
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
it('validates pickup versions/distance, carries one special, preserves primary ammo and resets on death', async () => {
  const r = await open('practice-pickups'); await wait(() => r.state.weaponPickups?.size === 3);
  const p = human(r);
  expect(r.state.pickupPractice).toBe(true); expect(p.specialWeapon).toBe('');
  r.send('weapon:select', 'pump'); r.send('weapon:collect', { id: '2', version: 0 }); r.send('weapon:collect', { id: 'bogus', version: 0 });
  await delay(100); expect(p.weapon).toBe('solder'); expect(p.specialWeapon).toBe('');
  const collect = (id: string, version = r.state.weaponPickups.get(id)!.version) => r.send('weapon:collect', { id, version });
  collect('0'); collect('0'); await wait(() => p.specialWeapon === 'iron'); expect(p.weapon).toBe('iron');
  expect(r.state.weaponPickups.get('0')!.version).toBe(1);
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

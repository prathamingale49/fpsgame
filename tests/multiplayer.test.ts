import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { MatchState } from '../server/state';
import { initialMotion, MOVEMENT_PROTOCOL, PLAYER, stepMotion, testMap, TICK, type Input, type Motion } from '../shared/game';

const port = 26673;
let server: ChildProcess;
const clients: Client[] = [];
const rooms: { leave(): Promise<unknown> }[] = [];
beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PCB_TEST_MAP: '1', PCB_TEST_PICKUP_SECONDS: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* starting */ }
    await delay(100);
  }
  expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
});
afterAll(async () => { for (const room of rooms) try { await room.leave(); } catch { /* already gone */ } server?.kill(); });

async function waitFor(predicate: () => boolean, ms = 3000) {
  const start = Date.now(); while (!predicate() && Date.now() - start < ms) await delay(25);
  expect(predicate()).toBe(true);
}
describe('real Colyseus clients', () => {
  it('buffers out-of-order movement and ignores duplicate sequences', async () => {
    const a = await new Client(`ws://127.0.0.1:${port}`).create<MatchState>('pcb', { name: 'Order A', protocol: MOVEMENT_PROTOCOL }); rooms.push(a);
    const b = await new Client(`ws://127.0.0.1:${port}`).joinById<MatchState>(a.roomId, { name: 'Order B', protocol: MOVEMENT_PROTOCOL }); rooms.push(b);
    await waitFor(() => a.state.phase === 'playing' && b.state.players.size === 2);
    const start = a.state.players.get(a.sessionId)!.z;
    const move = (seq: number) => a.send('input', { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false });
    move(2); await delay(120);
    expect(a.state.players.get(a.sessionId)!.ack).toBe(0);
    move(1); await waitFor(() => a.state.players.get(a.sessionId)!.ack === 2 && b.state.players.get(a.sessionId)!.ack === 2);
    expect(a.state.players.get(a.sessionId)!.z).toBeCloseTo(start - 2 * PLAYER.walkSpeed * TICK, 3);
    move(2); await delay(120);
    expect(a.state.players.get(a.sessionId)!.ack).toBe(2);
    expect(a.state.players.get(a.sessionId)!.z).toBeCloseTo(start - 2 * PLAYER.walkSpeed * TICK, 3);
    await a.leave(); await b.leave();
  }, 7000);
  it('processes ordered inputs through simulated latency and jitter', async () => {
    const a = await new Client(`ws://127.0.0.1:${port}`).create<MatchState>('pcb', { name: 'Latency A', protocol: MOVEMENT_PROTOCOL }); rooms.push(a);
    const b = await new Client(`ws://127.0.0.1:${port}`).joinById<MatchState>(a.roomId, { name: 'Latency B', protocol: MOVEMENT_PROTOCOL }); rooms.push(b);
    await waitFor(() => a.state.phase === 'playing');
    let expected: Motion = initialMotion([0, 0, 0]), seq = 0;
    for (const latency of [0, 50, 100, 200]) {
      const inputs: Input[] = Array.from({ length: 20 }, (_, i) => ({ seq: ++seq, forward: i < 12 ? 1 : 0, strafe: 0, yaw: 0, pitch: 0, jump: i === 0, sprint: false }));
      let arrival = 0;
      const deliveries = inputs.map((input, i) => {
        arrival = Math.max(arrival + 1, i * 16.7 + latency + ((i * 17) % 33) - 16);
        return delay(Math.max(0, arrival)).then(() => a.send('input', input));
      });
      for (const input of inputs) expected = stepMotion(expected, input, { ...testMap, boxes: [] });
      await Promise.all(deliveries);
      await waitFor(() => a.state.players.get(a.sessionId)?.ack === seq && b.state.players.get(a.sessionId)?.ack === seq);
      expect(a.state.players.get(a.sessionId)!.z).toBeCloseTo(expected.z, 3);
      expect(a.state.players.get(a.sessionId)!.y).toBeCloseTo(expected.y, 3);
    }
    await a.leave(); await b.leave();
  }, 10000);
  it('rate limits shots, reloads partial magazines, and synchronizes solder spools', async () => {
    const a = await new Client(`ws://127.0.0.1:${port}`).create<MatchState>('pcb', { name: 'Solder A', protocol: MOVEMENT_PROTOCOL }); rooms.push(a);
    const b = await new Client(`ws://127.0.0.1:${port}`).joinById<MatchState>(a.roomId, { name: 'Solder B', protocol: MOVEMENT_PROTOCOL }); rooms.push(b);
    await waitFor(() => a.state.phase === 'playing' && b.state.players.size === 2);
    a.send('shoot'); a.send('shoot'); a.send('shoot');
    await waitFor(() => a.state.players.get(a.sessionId)?.ammo === 29);
    await delay(130); a.send('shoot');
    await waitFor(() => a.state.players.get(a.sessionId)?.ammo === 28);
    a.send('reload');
    await waitFor(() => a.state.players.get(a.sessionId)?.reloading === true);
    a.send('shoot'); await delay(100);
    expect(a.state.players.get(a.sessionId)?.ammo).toBe(28);
    await waitFor(() => a.state.players.get(a.sessionId)?.ammo === 30, 3000);
    expect(a.state.players.get(a.sessionId)?.reserve).toBe(58);
    for (let seq = 1; seq <= 34; seq++) {
      a.send('input', { seq, forward: 0, strafe: 1, yaw: 0, pitch: 0, jump: false, sprint: false, reserve: 120 });
      await delay(17);
    }
    await waitFor(() => a.state.players.get(a.sessionId)?.reserve === 88 && b.state.pickups.get('0')?.active === false);
    expect(b.state.players.get(a.sessionId)?.reserve).toBe(88);
    for (let seq = 35; seq <= 49; seq++) {
      a.send('input', { seq, forward: 0, strafe: -1, yaw: 0, pitch: 0, jump: false, sprint: false });
      await delay(17);
    }
    await waitFor(() => a.state.pickups.get('0')?.active === true && b.state.pickups.get('0')?.active === true, 2500);
    await a.leave(); await b.leave();
  }, 10000);
  it('creates, joins, synchronizes movement, combat and disconnect', async () => {
    const c1 = new Client(`ws://127.0.0.1:${port}`), c2 = new Client(`ws://127.0.0.1:${port}`); clients.push(c1, c2);
    const a = await c1.create<MatchState>('pcb', { name: 'Alpha', protocol: MOVEMENT_PROTOCOL }); rooms.push(a);
    const b = await c2.joinById<MatchState>(a.roomId, { name: 'Bravo', protocol: MOVEMENT_PROTOCOL }); rooms.push(b);
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2 && a.state.phase === 'playing');
    const startZ = a.state.players.get(a.sessionId)!.z;
    a.send('input', { seq: 1, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false });
    await waitFor(() => a.state.players.get(a.sessionId)!.z < startZ - .2 && b.state.players.get(a.sessionId)!.z < startZ - .2);
    // Aim at Bravo; authoritative positions and damage must reach both clients.
    a.send('input', { seq: 2, forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false });
    await delay(100);
    for (let i = 0; i < 4; i++) { a.send('shoot'); await delay(130); }
    await waitFor(() => a.state.players.get(b.sessionId)!.deaths === 1 && b.state.players.get(b.sessionId)!.hp === 0);
    expect(a.state.players.get(a.sessionId)!.kills).toBe(1);
    await waitFor(() => b.state.players.get(b.sessionId)!.alive, 4000);
    expect(b.state.players.get(b.sessionId)!.hp).toBe(100);
    await b.leave();
    await waitFor(() => a.state.players.size === 1);
  }, 12000);
  it('announces a winner and resets after a match', async () => {
    const matchPort = port + 1;
    const quickServer = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(matchPort), PCB_TEST_MAP: '1', PCB_TEST_MATCH_SECONDS: '2' }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`http://127.0.0.1:${matchPort}/api/health`)).ok) break; } catch { /* starting */ }
        await delay(100);
      }
      const a = await new Client(`ws://127.0.0.1:${matchPort}`).create<MatchState>('pcb', { name: 'Timer A', protocol: MOVEMENT_PROTOCOL });
      const b = await new Client(`ws://127.0.0.1:${matchPort}`).joinById<MatchState>(a.roomId, { name: 'Timer B', protocol: MOVEMENT_PROTOCOL });
      await waitFor(() => a.state.phase === 'playing');
      await waitFor(() => a.state.phase === 'ended' && !!a.state.winner, 4000);
      await waitFor(() => b.state.phase === 'ended');
      expect(b.state.winner).toBe('Timer A');
      await waitFor(() => a.state.phase === 'playing' && a.state.seconds === 2, 10000);
      await a.leave(); await b.leave();
    } finally { quickServer.kill(); }
  }, 16000);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { MatchState } from '../server/state';

const port = 26673;
let server: ChildProcess;
const clients: Client[] = [];
const rooms: { leave(): Promise<unknown> }[] = [];
beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PCB_TEST_MAP: '1' }, stdio: 'ignore' });
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
  it('creates, joins, synchronizes movement, combat and disconnect', async () => {
    const c1 = new Client(`ws://127.0.0.1:${port}`), c2 = new Client(`ws://127.0.0.1:${port}`); clients.push(c1, c2);
    const a = await c1.create<MatchState>('pcb', { name: 'Alpha' }); rooms.push(a);
    const b = await c2.joinById<MatchState>(a.roomId, { name: 'Bravo' }); rooms.push(b);
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
      const a = await new Client(`ws://127.0.0.1:${matchPort}`).create<MatchState>('pcb', { name: 'Timer A' });
      const b = await new Client(`ws://127.0.0.1:${matchPort}`).joinById<MatchState>(a.roomId, { name: 'Timer B' });
      await waitFor(() => a.state.phase === 'playing');
      await waitFor(() => a.state.phase === 'ended' && !!a.state.winner, 4000);
      await waitFor(() => b.state.phase === 'ended');
      expect(b.state.winner).toBe('Timer A');
      await waitFor(() => a.state.phase === 'playing' && a.state.seconds === 2, 10000);
      await a.leave(); await b.leave();
    } finally { quickServer.kill(); }
  }, 16000);
});

import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOVEMENT_PROTOCOL } from '../shared/game.js';
import type { MatchState } from '../server/state.js';

it('runs isolated solo targets with movement control, shared damage and three-second respawn', async () => {
  const port = 26695;
  const server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/practice-server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const rooms: Room<MatchState>[] = [];
  const wait = async (predicate: () => boolean, ms = 4000) => { const until = Date.now() + ms; while (!predicate() && Date.now() < until) await delay(25); expect(predicate()).toBe(true); };
  try {
    await delay(1500);
    const client = new Client(`ws://localhost:${port}`), options = { protocol: MOVEMENT_PROTOCOL };
    const room = await client.create<MatchState>('practice', options); rooms.push(room);
    room.onMessage('*', () => {});
    await wait(() => room.state.players?.size === 6);
    expect(room.state.practice).toBe(true); expect(room.state.phase).toBe('playing');
    expect([...room.state.players.values()].filter(p => p.npc)).toHaveLength(5);
    const fixed = room.state.players.get('npc-0')!;
    const start = [...room.state.players.values()].filter(p => p.npc).map(p => [p.x, p.z]);
    for (let sample = 0; sample < 15; sample++) {
      await delay(100);
      for (const p of room.state.players.values()) if (p.npc) {
        expect(Math.abs(p.x)).toBeLessThan(10); expect(Math.abs(p.z)).toBeLessThan(10);
        const dx = Math.max(2 - p.x, 0, p.x - 3), dz = Math.max(-2 - p.z, 0, p.z - 2);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(.179);
      }
    }
    expect([fixed.x, fixed.z]).toEqual(start[0]);
    expect([...room.state.players.values()].filter(p => p.npc).some((p, i) => Math.hypot(p.x - start[i][0], p.z - start[i][1]) > .1)).toBe(true);
    room.send('practice:movement'); await wait(() => !room.state.npcMovement);
    const frozen = [...room.state.players.values()].filter(p => p.npc).map(p => [p.x, p.y, p.z]);
    await delay(300);
    expect([...room.state.players.values()].filter(p => p.npc).map(p => [p.x, p.y, p.z])).toEqual(frozen);
    const aim = Math.atan2(-fixed.x, -fixed.z);
    room.send('input', { seq: 1, forward: 0, strafe: 0, yaw: aim, pitch: 0, jump: false, sprint: false });
    await wait(() => room.state.players.get(room.sessionId)?.ack === 1);
    for (let i = 0; i < 4; i++) { room.send('shoot'); await delay(150); }
    await wait(() => !fixed.alive);
    const killedAt = Date.now(); await delay(1800); expect(fixed.alive).toBe(false);
    await wait(() => fixed.alive, 2200); expect(Date.now() - killedAt).toBeGreaterThan(2400); expect(fixed.hp).toBe(100);
    expect(room.state.players.get(room.sessionId)?.hp).toBe(100);
    expect([...room.state.players.values()].filter(p => p.npc).every(p => p.ammo === 30 && p.kills === 0)).toBe(true);
    room.send('practice:movement'); await wait(() => room.state.npcMovement);
    const publicRoom = await client.joinOrCreate<MatchState>('pcb', options); rooms.push(publicRoom);
    publicRoom.onMessage('*', () => {});
    await wait(() => publicRoom.state.players?.size === 1);
    expect(publicRoom.state.practice).toBe(false); expect(publicRoom.state.phase).toBe('waiting');
    await expect(client.joinById(room.roomId, options)).rejects.toThrow();
    expect(room.state.phase).toBe('playing'); expect(room.state.winner).toBe('');
  } finally { for (const room of rooms) await room.leave(); server.kill(); }
}, 18000);

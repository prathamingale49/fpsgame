import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOVEMENT_PROTOCOL, hitscan, aimRay, testMap, type Motion } from '../shared/game.js';
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
    const targets = [...room.state.players.entries()].map(([id, p]) => [id, p as unknown as Motion] as [string, Motion]);
    const map = { ...testMap, width: 20, depth: 20, boxes: [{ min: [2, 0, -2] as [number, number, number], max: [3, 4, 2] as [number, number, number] }] };
    const visible = targets.find(([id, p]) => id.startsWith('npc-') && hitscan(aimRay(0, 0, 0, Math.atan2(-p.x, -p.z), 0), map, targets, room.sessionId).target === id)!;
    expect(visible).toBeDefined();
    const victim = room.state.players.get(visible[0])!;
    const aim = Math.atan2(-victim.x, -victim.z);
    room.send('input', { seq: 1, forward: 0, strafe: 0, yaw: aim, pitch: 0, jump: false, sprint: false });
    await wait(() => room.state.players.get(room.sessionId)?.ack === 1);
    const eliminations: { name: string; target: string; chain: number }[] = [];
    room.onMessage('elimination', msg => eliminations.push(msg));
    for (let i = 0; i < 4; i++) { room.send('shoot'); await delay(150); }
    await wait(() => !victim.alive);
    expect(eliminations).toEqual([{ name: victim.name, target: visible[0], chain: 1 }]);
    const killedAt = Date.now(); await delay(1800); expect(victim.alive).toBe(false);
    await wait(() => victim.alive, 2200); expect(Date.now() - killedAt).toBeGreaterThan(2400); expect(victim.hp).toBe(100);
    expect(room.state.players.get(room.sessionId)?.hp).toBe(100);
    expect([...room.state.players.values()].filter(p => p.npc).every(p => p.ammo === 30 && p.kills === 0)).toBe(true);
    const beforeResume = [...room.state.players.values()].filter(p => p.npc).map(p => [p.x, p.z]);
    room.send('practice:movement'); await wait(() => room.state.npcMovement);
    await wait(() => [...room.state.players.values()].filter(p => p.npc).some((p, i) => Math.hypot(p.x - beforeResume[i][0], p.z - beforeResume[i][1]) > .1));
    expect(room.state.seconds).toBe(300);
    const publicRoom = await client.joinOrCreate<MatchState>('pcb', options); rooms.push(publicRoom);
    publicRoom.onMessage('*', () => {});
    await wait(() => publicRoom.state.players?.size === 1);
    expect(publicRoom.state.practice).toBe(false); expect(publicRoom.state.phase).toBe('waiting');
    await expect(client.joinById(room.roomId, options)).rejects.toThrow();
    expect(room.state.phase).toBe('playing'); expect(room.state.winner).toBe('');
    // PR #5's authoritative flip lock also applies inside Solo Practice.
    const input = (seq: number, forward = 0) => room.send('input', { seq, forward, strafe: 0, yaw: 0, pitch: 0, jump: true, sprint: true });
    for (let seq = 2; seq <= 64; seq++) input(seq, 1);
    await wait(() => room.state.players.get(room.sessionId)?.ack === 64);
    const human = room.state.players.get(room.sessionId)!;
    expect(human.side).toBe('back'); expect(human.transitionCooldown).toBeGreaterThan(0);
    const position = [human.x, human.z], ammo = human.ammo;
    input(65, 1); await wait(() => human.ack === 65);
    expect([human.x, human.z]).toEqual(position);
    room.send('shoot'); await delay(150); expect(human.ammo).toBe(ammo);
    for (let seq = 66; seq <= 125; seq++) input(seq);
    await wait(() => human.ack === 125 && human.transitionCooldown === 0);
    room.send('shoot'); await wait(() => human.ammo === ammo - 1);
    expect(human.hp).toBe(100); expect(room.state.players.size).toBe(6);
  } finally { for (const room of rooms) await room.leave(); server.kill(); }
}, 18000);

import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOVEMENT_PROTOCOL, stepMotion, testMap, type Motion } from '../shared/game.js';
import type { MatchState } from '../server/state.js';

it('synchronizes repeated wraps without deaths and isolates combat between surfaces', async () => {
  const port = 26687;
  const server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/side-server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let a: Room<MatchState> | undefined, b: Room<MatchState> | undefined;
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await delay(30);
    expect(predicate()).toBe(true);
  };
  try {
    for (let i = 0; i < 60; i++) {
      try { a = await new Client(`ws://localhost:${port}`).create<MatchState>('pcb', { protocol: MOVEMENT_PROTOCOL }); break; } catch { await delay(100); }
    }
    expect(a).toBeDefined();
    b = await new Client(`ws://localhost:${port}`).joinById<MatchState>(a!.roomId, { protocol: MOVEMENT_PROTOCOL });
    await wait(() => a!.state.phase === 'playing' && b!.state.players.size === 2);
    let seqA = 0, seqB = 0;
    const move = async (room: Room<MatchState>, count: number, forward: number, yaw = 0) => {
      const p = room.state.players.get(room.sessionId)!;
      let predicted: Motion = { x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded, jumpHeld: p.jumpHeld, mantleTarget: p.mantleTarget, side: p.side as 'front' | 'back', transitionCooldown: p.transitionCooldown, headingOffset: p.headingOffset };
      const predictionMap = { ...testMap, width: 12, depth: 12, boxes: [], back: { enabled: true, thickness: 1.6, boxes: [] } };
      for (let i = 0; i < count; i++) {
        const seq = room === a ? ++seqA : ++seqB;
        const input = { seq, forward, strafe: 0, yaw, pitch: 0, jump: false, sprint: true };
        predicted = stepMotion(predicted, input, predictionMap);
        room.send('input', input);
        await delay(17);
      }
      const seq = room === a ? seqA : seqB;
      await wait(() => room.state.players.get(room.sessionId)?.ack === seq);
      const authoritative = room.state.players.get(room.sessionId)!;
      expect(authoritative.side).toBe(predicted.side);
      expect(authoritative.x).toBeCloseTo(predicted.x, 3);
      expect(authoritative.y).toBeCloseTo(predicted.y, 3);
      expect(authoritative.z).toBeCloseTo(predicted.z, 3);
    };
    await move(a!, 12, 1);
    await wait(() => b!.state.players.get(a!.sessionId)?.side === 'back');
    const pa = () => a!.state.players.get(a!.sessionId)!;
    const pb = () => a!.state.players.get(b!.sessionId)!;
    expect(pa().deaths).toBe(0); expect(pa().hp).toBe(100);
    // Shooting through the flip would undermine the movement lock.
    a!.send('shoot');
    await delay(125);
    expect(pa().ammo).toBe(30);
    await move(a!, 56, 0);
    expect(pa().transitionCooldown).toBe(0);
    const aim = Math.atan2(-(pb().x - pa().x), -(pb().z - pa().z));
    await move(a!, 1, 0, aim);
    a!.send('shoot');
    await wait(() => pa().ammo === 29);
    await delay(150);
    expect(pb().hp).toBe(100);
    // Bravo reaches the back through the north edge, then occupies the same arena.
    await move(b!, 40, 1);
    await wait(() => pb().side === 'back');
    const sameAim = Math.atan2(-(pb().x - pa().x), -(pb().z - pa().z));
    await move(a!, 1, 0, sameAim);
    a!.send('shoot');
    await wait(() => pb().hp === 75 && b!.state.players.get(b!.sessionId)?.hp === 75);
    const remainingAmmo = pa().ammo;
    await move(a!, 95, 1, 0);
    await wait(() => pa().side === 'front' && b!.state.players.get(a!.sessionId)?.side === 'front');
    expect(pa().deaths).toBe(0); expect(pa().kills).toBe(0);
    expect(pa().hp).toBe(100); expect(pa().ammo).toBe(remainingAmmo);
    expect(a!.state.phase).toBe('playing');
  } finally { await a?.leave(); await b?.leave(); server.kill(); }
}, 22000);

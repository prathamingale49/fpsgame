import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import { MOVEMENT_PROTOCOL, onBoard, type MapData } from '../shared/game.js';
import type { MatchState } from '../server/state.js';

it('keeps concurrent practice maps isolated and ignores map requests in public rooms', async () => {
  const port = 26714;
  const server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/map-isolation-server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const rooms: Room<MatchState>[] = [];
  try {
    await delay(1500);
    const client = new Client(`ws://localhost:${port}`);
    for (const [kind, id, expected] of [['practice','recovery','recovery'], ['practice','flight-sam','flight-sam'], ['pcb','recovery','bms'], ['practice',undefined,'bms']]) {
      const room = await client.create<MatchState>(kind!, { protocol: MOVEMENT_PROTOCOL, mapId: id }); rooms.push(room);
      room.onMessage('*', () => {});
      const until = Date.now()+4000;
      while (!room.state.players?.size && Date.now()<until) await delay(25);
      expect(room.state.mapId).toBe(expected);
    }
    await delay(500);
    for (const room of rooms) {
      const map: MapData = JSON.parse(fs.readFileSync(`assets/public/maps/${room.state.mapId}.json`, 'utf8'));
      expect(room.state.players.size).toBe(room.state.practice ? 6 : 1);
      for (const player of room.state.players.values()) {
        expect(onBoard(map,player.x,player.z,player.side as 'front'|'back')).toBe(true);
        expect(player.alive).toBe(true);
      }
    }
    expect(rooms[0].state.mapId).toBe('recovery');
  } finally { for (const room of rooms) await room.leave(); server.kill(); }
}, 18000);

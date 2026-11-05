import { defineServer, defineRoom } from 'colyseus';
import fs from 'node:fs';
import { GameRoom, PracticeRoom, registerPracticeMap, setActiveMap } from '../../server/room.js';
import type { MapData } from '../../shared/game.js';
for (const id of ['bms', 'recovery', 'flight-sam']) {
  const map = JSON.parse(fs.readFileSync(`assets/public/maps/${id}.json`, 'utf8')) as MapData;
  registerPracticeMap(map);
  if (id === 'bms') setActiveMap(map);
}
await defineServer({ rooms: { pcb: defineRoom(GameRoom), practice: defineRoom(PracticeRoom) } }).listen(Number(process.env.PORT));

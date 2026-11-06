import { defineServer, defineRoom } from 'colyseus';
import fs from 'node:fs';
import { GameRoom, PracticeRoom, registerPracticeMap, setActiveMap, setMultiplayerMaps, practiceMaps } from '../../server/room.js';
import type { MapData } from '../../shared/game.js';
for (const id of ['bms', 'recovery', 'flight-sam']) {
  const map = JSON.parse(fs.readFileSync(`assets/public/maps/${id}.json`, 'utf8')) as MapData;
  registerPracticeMap(map);
  if (id === 'bms') setActiveMap(map);
}
if (process.env.PCB_ROTATE_TEST === '1') {
  let seed = 421; Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  setMultiplayerMaps([...practiceMaps.values()]);
}
await defineServer({ rooms: { pcb: defineRoom(GameRoom), practice: defineRoom(PracticeRoom) } }).listen(Number(process.env.PORT));

console.log('MAP_ISOLATION_READY');

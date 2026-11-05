import { defineServer, defineRoom } from 'colyseus';
import { GameRoom, PracticeRoom, setActiveMap } from '../../server/room.js';
import { testMap } from '../../shared/game.js';
setActiveMap({ ...testMap, width: 20, depth: 20, spawns: [[0, 0, 0]], boxes: [{ min: [2, 0, -2], max: [3, 4, 2] }], back: { enabled: true, thickness: 1.6, boxes: [] } });
await defineServer({ rooms: { pcb: defineRoom(GameRoom), practice: defineRoom(PracticeRoom) } }).listen(Number(process.env.PORT));

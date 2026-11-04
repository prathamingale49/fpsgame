import { defineServer, defineRoom } from 'colyseus';
import { GameRoom, setActiveMap } from '../../server/room.js';
import { testMap } from '../../shared/game.js';
setActiveMap({ ...testMap, width: 12, depth: 12, boxes: [],
  spawns: [[0, 0, -5.8], [0, 0, 0], [3, 0, 0]],
  back: { enabled: true, thickness: 1.6, boxes: [] } });
await defineServer({ rooms: { pcb: defineRoom(GameRoom) } }).listen(Number(process.env.PORT));

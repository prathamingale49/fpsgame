import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GameRoom, setActiveMap, activeMap } from './room.js';
import type { MapData } from '../shared/game.js';
import { testMap } from '../shared/game.js';

const mapFile = path.resolve('assets/public/maps/bms.json');
if (existsSync(mapFile)) {
  try { setActiveMap(JSON.parse(readFileSync(mapFile, 'utf8')) as MapData); }
  catch (error) { console.error('Could not load BMS map, using prototype:', error); }
}
if (process.env.PCB_TEST_MAP === '1') setActiveMap({ ...testMap, boxes: [], spawns: [[0, 0, 0], [0, 0, -12], [8, 0, 0]] });
const app = defineServer({
  rooms: { pcb: defineRoom(GameRoom) },
  express: (router) => {
    router.get('/api/health', (_req, res) => res.json({ ok: true, map: activeMap.id }));
    router.get('/api/map', (_req, res) => res.json(activeMap));
    router.use(express.static(path.resolve('dist')));
    router.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  },
});
const port = Number(process.env.PORT || 2567);
app.listen(port);
console.log(`PCB FPS listening on ${port}, map ${activeMap.id}`);

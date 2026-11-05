import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import { PRACTICE_MAPS } from '../shared/maps.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GameRoom, PracticeRoom, setActiveMap, activeMap, serverPerf, DEV_SCALE_ENABLED, registerPracticeMap, practiceMaps } from './room.js';
import type { MapData } from '../shared/game.js';
import { MOVEMENT_PROTOCOL, testMap } from '../shared/game.js';

const mapId = process.env.PCB_MAP_ID || 'bms';
if (!/^[a-z0-9_-]+$/.test(mapId)) throw new Error('Invalid PCB_MAP_ID');
const mapFile = path.resolve(`assets/public/maps/${mapId}.json`);
if (existsSync(mapFile)) {
  try { setActiveMap(JSON.parse(readFileSync(mapFile, 'utf8')) as MapData); }
  catch (error) { console.error('Could not load BMS map, using prototype:', error); }
}
if (process.env.PCB_TEST_MAP === '1') setActiveMap({ ...testMap, boxes: [], spawns: [[0, 0, 0], [0, 0, -12], [8, 0, 0]] });
for (const { id } of PRACTICE_MAPS) {
  const file = path.resolve(`assets/public/maps/${id}.json`);
  if (existsSync(file)) registerPracticeMap(JSON.parse(readFileSync(file, 'utf8')) as MapData);
}
const app = defineServer({
  rooms: { pcb: defineRoom(GameRoom), practice: defineRoom(PracticeRoom) },
  express: (router) => {
    router.get('/api/health', (_req, res) => res.json({ ok: true, map: activeMap.id, movementProtocol: MOVEMENT_PROTOCOL,
      devScaleEnabled: DEV_SCALE_ENABLED,
      ...(process.env.PCB_SOAK_METRICS === '1' ? { perf: { ...serverPerf, cache: serverPerf.cache(), heapMB: process.memoryUsage().heapUsed / 1048576 } } : {}) }));
    router.get('/api/map', (req, res) => {
      const id = typeof req.query.practiceMap === 'string' ? req.query.practiceMap : undefined;
      if (id && !practiceMaps.has(id)) { res.sendStatus(404); return; }
      res.json(id ? practiceMaps.get(id) : activeMap);
    });
    router.use(express.static(path.resolve('dist')));
    router.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  },
});
const port = Number(process.env.PORT || 2567);
app.listen(port);
console.log(`PCB FPS listening on ${port}, map ${activeMap.id}`);

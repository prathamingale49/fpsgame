// Test-only entry point: actual BMS geometry, with controlled edge starts.
import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { GameRoom, setActiveMap } from '../../server/room.js';
import type { MapData } from '../../shared/game.js';
import { MOVEMENT_PROTOCOL } from '../../shared/game.js';
const map = JSON.parse(fs.readFileSync('assets/public/maps/bms.json', 'utf8')) as MapData;
if (!map.back?.enabled) throw new Error('BMS two-sided import required');
const edge = process.env.TEST_EDGE || 'north';
const x = edge === 'east' ? map.width / 2 - .1 : edge === 'west' ? -map.width / 2 + .1 : 0;
const z = edge === 'south' ? map.depth / 2 - .1 : edge === 'north' ? -map.depth / 2 + .1 : 0;
const y = Math.max(0, ...map.boxes.filter(b => x + .3 > b.min[0] && x - .3 < b.max[0] && z + .3 > b.min[2] && z - .3 < b.max[2]).map(b => b.max[1])) + .02;
map.spawns = [[x, y, z], map.spawns[0], ...map.spawns.slice(1)];
setActiveMap(map);
await defineServer({ rooms: { pcb: defineRoom(GameRoom) }, express: router => {
  router.get('/api/health', (_req, res) => res.json({ ok: true, movementProtocol: MOVEMENT_PROTOCOL, devScaleEnabled: false }));
  router.get('/api/map', (_req, res) => res.json(map));
  router.use(express.static(path.resolve('dist')));
} }).listen(Number(process.env.PORT));

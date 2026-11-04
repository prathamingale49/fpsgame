import fs from 'node:fs';
import path from 'node:path';
import { PLAYER_RADIUS, type MapData } from '../shared/game.js';

const directory = path.resolve('assets/public/maps');
const mapId = process.argv[2] || 'bms';
const map = JSON.parse(fs.readFileSync(path.join(directory, `${mapId}.json`), 'utf8')) as MapData;
const outside = (map.components ?? []).filter(c => Math.abs(c.x) > map.width / 2 + 1 || Math.abs(c.z) > map.depth / 2 + 1);
const blocked = map.spawns.filter(([x, y, z]) => map.boxes.some(b => {
  const dx = Math.max(b.min[0] - x, 0, x - b.max[0]), dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
  return dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS && y < b.max[1];
}));
const outsideSpawns = map.spawns.filter(([x, , z]) => Math.abs(x) >= map.width / 2 - PLAYER_RADIUS || Math.abs(z) >= map.depth / 2 - PLAYER_RADIUS);
const headers = map.boxes.filter(b => b.kind === 'header');
const connectors = map.boxes.filter(b => b.kind === 'connector');
const invalidBoxes = map.boxes.filter(b => b.min.some((v, i) => !Number.isFinite(v) || v >= b.max[i]));
const named = new Set(map.boxes.map(b => b.name));
const matched = (map.components ?? []).filter(c => named.has(c.ref));
const files = [map.model, map.texture].filter((url): url is string => Boolean(url)).map(url => { const name = path.basename(url); return { name, bytes: fs.statSync(path.join(directory, name)).size }; });
const report = { board: [map.width, map.depth], solids: map.boxes.length, headers: headers.map(b => ({ name: b.name, width: +(b.max[0] - b.min[0]).toFixed(2), depth: +(b.max[2] - b.min[2]).toFixed(2), height: +b.max[1].toFixed(2) })), climbableConnectors: connectors.filter(b => b.climbable).length, tallestComponent: map.boxes.reduce((best, b) => b.max[1] > best.height ? { name: b.name ?? '', height: b.max[1] } : best, { name: '', height: 0 }), spawns: map.spawns.length, csvPlacements: map.components?.length ?? 0, collidableDesignatorsMatchedToCsv: matched.length, csvOutsideBoard: outside.length, blockedSpawns: blocked.length, outsideSpawns: outsideSpawns.length, invalidBoxes: invalidBoxes.length, files };
console.log(JSON.stringify(report, null, 2));
if (outside.length || blocked.length || outsideSpawns.length || invalidBoxes.length || map.spawns.length < 2 || map.boxes.length < 10
  || (mapId === 'bms' && (headers.length < 2 || connectors.filter(b => b.climbable).length < 8))) process.exitCode = 1;

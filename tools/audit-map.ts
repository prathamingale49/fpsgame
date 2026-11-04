import fs from 'node:fs';
import path from 'node:path';
import type { MapData } from '../shared/game.js';

const directory = path.resolve('assets/public/maps');
const mapId = process.argv[2] || 'bms';
const map = JSON.parse(fs.readFileSync(path.join(directory, `${mapId}.json`), 'utf8')) as MapData;
const outside = (map.components ?? []).filter(c => Math.abs(c.x) > map.width / 2 + 1 || Math.abs(c.z) > map.depth / 2 + 1);
const blocked = map.spawns.filter(([x, y, z]) => map.boxes.some(b => x + .48 > b.min[0] && x - .48 < b.max[0] && z + .48 > b.min[2] && z - .48 < b.max[2] && y < b.max[1]));
const named = new Set(map.boxes.map(b => b.name));
const matched = (map.components ?? []).filter(c => named.has(c.ref));
const files = [map.model, map.texture].filter((url): url is string => Boolean(url)).map(url => { const name = path.basename(url); return { name, bytes: fs.statSync(path.join(directory, name)).size }; });
const report = { board: [map.width, map.depth], solids: map.boxes.length, tallestComponent: map.boxes.reduce((best, b) => b.max[1] > best.height ? { name: b.name ?? '', height: b.max[1] } : best, { name: '', height: 0 }), spawns: map.spawns.length, csvPlacements: map.components?.length ?? 0, collidableDesignatorsMatchedToCsv: matched.length, csvOutsideBoard: outside.length, blockedSpawns: blocked.length, files };
console.log(JSON.stringify(report, null, 2));
if (outside.length || blocked.length || map.spawns.length < 2 || map.boxes.length < 10) process.exitCode = 1;

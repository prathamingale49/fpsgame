import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import * as current from '../shared/game';

if (!process.env.BENCH_BASELINE) throw new Error('Set BENCH_BASELINE to a checkout of the baseline revision');
const oldPath = path.join(process.env.BENCH_BASELINE, 'shared/game.ts');
const baseline = await import(pathToFileURL(oldPath).href) as typeof current;
const bms = JSON.parse(readFileSync('assets/public/maps/bms.json', 'utf8')) as current.MapData;
const synthetic: current.MapData = { ...current.testMap, boxes: Array.from({ length: 1000 }, (_, i) => ({ min: [i % 40 * 2 - 40, 0, Math.floor(i / 40) * 2 - 25], max: [i % 40 * 2 - 39, 2, Math.floor(i / 40) * 2 - 24] })) };
const input: current.Input = { seq: 1, forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false };
for (const [name, map, point] of [['bms-dense', bms, [-1.46, 0, 9.21]], ['synthetic-1000', synthetic, [0, 0, 0]]] as const) {
  const results = [];
  for (const [version, game] of [['main', baseline], ['branch', current]] as const) {
    const motion = game.initialMotion(point as current.Spawn), stats = { collisionChecks: 0 };
    for (let i = 0; i < 100; i++) game.stepMotion(motion, input, map);
    const start = performance.now();
    for (let i = 0; i < 10000; i++) game.stepMotion(motion, input, map);
    if (version === 'branch') game.stepMotion(motion, input, map, game.TICK, stats);
    results.push({ version, msPer10000: +(performance.now() - start).toFixed(2), geometryChecksPerStep: version === 'branch' ? stats.collisionChecks : undefined, boxesOnMap: map.boxes.length });
  }
  console.log(JSON.stringify({ map: name, results }));
}

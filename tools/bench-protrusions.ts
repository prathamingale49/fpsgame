// Compare map collision costs with the SAME runtime code, isolating import changes.
// Usage: npx tsx tools/bench-protrusions.ts <baseline-git-ref> [map-id]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { initialMotion, stepMotion, hitscan, aimRay, PLAYER, type MapData } from '../shared/game.js';
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline Git revision');
const file = `assets/public/maps/${process.argv[3] || 'bms'}.json`;
const maps = [JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { maxBuffer: 10 * 1024 * 1024 }).toString()), JSON.parse(readFileSync(file, 'utf8'))] as MapData[];
const input = { seq: 1, forward: 1, strafe: .3, yaw: .7, pitch: 0, jump: false, sprint: false };
const samples = maps.map(() => [] as number[]);
for (let pass = 0; pass < 6; pass++) for (const index of pass % 2 ? [1, 0] : [0, 1]) {
  const map = maps[index], stats = { collisionChecks: 0 }, start = performance.now();
  for (let i = 0; i < 20000; i++) {
    const x = ((i * 17) % 101) / 100 * (map.width - 4) - (map.width - 4) / 2;
    const z = ((i * 31) % 103) / 102 * (map.depth - 4) - (map.depth - 4) / 2;
    stepMotion({ ...initialMotion([x, .1, z]), side: 'back' }, input, map, undefined, stats);
  }
  const elapsed = performance.now() - start;
  if (pass) samples[index].push(elapsed);
  if (pass === 5) {
    const shotStart = performance.now();
    for (let i = 0; i < 10000; i++) hitscan(aimRay(0, 0, 0, i * .01, 0), map, [], 'shooter', PLAYER, 'back');
    const sorted = samples[index].sort((a, b) => a - b);
    console.log(JSON.stringify({ version: index ? 'regenerated' : ref, boxes: map.back?.boxes.length,
      medianMsPer20000Steps: +sorted[2].toFixed(2), collisionChecksPerStep: +(stats.collisionChecks / 20000).toFixed(2),
      msPer10000Shots: +(performance.now() - shotStart).toFixed(2) }));
  }
}

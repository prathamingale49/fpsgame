import { expect, it } from 'vitest';
import fs from 'node:fs';
import { initialMotion, onBoard, PLAYER, stepMotion, surfaceMap, TICK, type MapData } from '../shared/game.js';

for (const id of ['recovery', 'flight-sam']) it(`${id} has safe distributed spawns and a matching back surface`, () => {
  const map: MapData = JSON.parse(fs.readFileSync(`assets/public/maps/${id}.json`, 'utf8'));
  expect(map.surface!.length).toBeGreaterThan(6);
  expect(map.back?.enabled).toBe(true);
  expect(map.spawns).toHaveLength(8);
  for (const spawn of map.spawns) {
    expect(onBoard(map, spawn[0], spawn[2])).toBe(true);
    expect(map.boxes.some(b => spawn[0]+PLAYER.radius > b.min[0] && spawn[0]-PLAYER.radius < b.max[0] && spawn[2]+PLAYER.radius > b.min[2] && spawn[2]-PLAYER.radius < b.max[2])).toBe(false);
    expect(onBoard(surfaceMap(map, 'back'), spawn[0], -spawn[2])).toBe(true);
    const motion = stepMotion(initialMotion(spawn), { seq: 1, forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false }, map, TICK);
    expect(motion.grounded).toBe(true);
    expect(motion.y).toBe(0);
  }
});

it('Flight SAM has no floor across its side cutout', () => {
  const map: MapData = JSON.parse(fs.readFileSync('assets/public/maps/flight-sam.json', 'utf8'));
  expect(onBoard(map, map.width * .4, map.depth * .2)).toBe(false);
  expect(onBoard(map, -map.width * .4, map.depth * .2)).toBe(true);
});

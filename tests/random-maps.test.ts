import { expect, it } from 'vitest';
import fs from 'node:fs';
import { chooseMultiplayerMap, setMultiplayerMaps } from '../server/room.js';
import { weaponPickupLocations } from '../shared/weapon-pickups.js';
import { onBoard, surfaceMap, type MapData } from '../shared/game.js';

const maps: MapData[] = ['bms', 'recovery', 'flight-sam'].map(id => JSON.parse(fs.readFileSync(`assets/public/maps/${id}.json`, 'utf8')));
it('gives each map an equal third of the server selection range', () => {
  setMultiplayerMaps(maps);
  const counts = new Map<string, number>();
  for (let i = 0; i < 300; i++) {
    const id = chooseMultiplayerMap(() => (i + .5) / 300).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  expect([...counts.values()]).toEqual([100, 100, 100]);
  setMultiplayerMaps([]);
});
for (const map of maps) it(`${map.id} has eleven pickups with safe floors, collision clearance, and spacing`, () => {
  for (const seed of [1, 12345, 98765]) {
    const points = weaponPickupLocations(map, seed);
    expect(points).toHaveLength(11);
    points.forEach((point, index) => {
      for (const [dx,dz] of [[0,0],[-.9,0],[.9,0],[0,-.9],[0,.9]]) expect(onBoard(map,point.x+dx,point.z+dz,point.side)).toBe(true);
      expect(surfaceMap(map,point.side).boxes.some(b => b.max[1] > .3 && b.min[1] < 1.1 && point.x+.9>b.min[0] && point.x-.9<b.max[0] && point.z+.9>b.min[2] && point.z-.9<b.max[2])).toBe(false);
      for (const other of points.slice(0,index)) if(other.side===point.side) expect(Math.hypot(point.x-other.x,point.z-other.z)).toBeGreaterThanOrEqual(1.8);
    });
  }
});

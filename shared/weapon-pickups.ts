import { PLAYER, rayBox, surfaceMap, type MapData, type BoardSide } from './game.js';
import { validWeaponId } from './weapons.js';
export const WEAPON_PICKUPS = { radius: 1.5, respawnSeconds: 15 } as const;
export type WeaponPickup = { x: number; y: number; z: number; side: string; weapon: string; active: boolean; version: number };
type Point = { x: number; y: number; z: number; side: BoardSide };
const cache = new WeakMap<MapData, Point[]>();
export function weaponPickupLocations(map: MapData): Point[] {
  const cached = cache.get(map); if (cached) return cached;
  const regions: Partial<Record<BoardSide, Point[]>> = {};
  for (const side of (map.back?.enabled ? ['front', 'back'] : ['front']) as BoardSide[]) {
    const boxes = surfaceMap(map, side).boxes;
    const clear = (x: number, z: number) => !boxes.some(b => x + PLAYER.radius + .05 > b.min[0] && x - PLAYER.radius - .05 < b.max[0] && z + PLAYER.radius + .05 > b.min[2] && z - PLAYER.radius - .05 < b.max[2]);
    const cells = new Map<string, Point>();
    for (let x = -map.width / 2 + .6; x < map.width / 2 - .6; x++) for (let z = -map.depth / 2 + .6; z < map.depth / 2 - .6; z++) {
      if (clear(x, z)) cells.set(`${Math.round(x * 10)},${Math.round(z * 10)}`, { x, y: map.ground, z, side });
    }
    let start: string | undefined;
    let best = Infinity;
    for (const [key, p] of cells) {
      const score = side === 'front' ? Math.hypot(p.x - map.spawns[0][0], p.z - map.spawns[0][2]) : Math.min(map.width / 2 - Math.abs(p.x), map.depth / 2 - Math.abs(p.z));
      if (score < best) { best = score; start = key; }
    }
    const region: Point[] = [], visited = new Set<string>();
    if (start) { const queue = [start]; visited.add(start);
      for (let i = 0; i < queue.length; i++) {
        const p = cells.get(queue[i])!; region.push(p);
        const [kx, kz] = queue[i].split(',').map(Number);
        for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10], [0, -10]]) {
          const key = `${kx + dx},${kz + dz}`, next = cells.get(key);
          if (!next || visited.has(key)) continue;
          if (![.25, .5, .75].every(t => clear(p.x + (next.x - p.x) * t, p.z + (next.z - p.z) * t))) continue;
          visited.add(key); queue.push(key);
        }
      }
    }
    regions[side] = region;
  }
  const chosen: Point[] = [];
  for (let i = 0; i < 3; i++) {
    const side = i === 1 && regions.back?.length ? 'back' : 'front';
    const candidates = regions[side] ?? [];
    let point: Point | undefined, best = -Infinity;
    for (const p of candidates) {
      // Reserve space for the longest rotating miniature, not just the player.
      if (Math.abs(p.x) > map.width / 2 - .9 || Math.abs(p.z) > map.depth / 2 - .9) continue;
      if (surfaceMap(map, p.side).boxes.some(b => b.max[1] > p.y + .3 && b.min[1] < p.y + 1.1 && p.x + .9 > b.min[0] && p.x - .9 < b.max[0] && p.z + .9 > b.min[2] && p.z - .9 < b.max[2])) continue;
      const same = chosen.filter(q => q.side === p.side);
      const score = same.length ? Math.min(...same.map(q => Math.hypot(p.x - q.x, p.z - q.z))) : -Math.hypot(p.x - map.spawns[Math.min(i, map.spawns.length - 1)][0], p.z - map.spawns[Math.min(i, map.spawns.length - 1)][2]);
      if (score > best && same.every(q => Math.hypot(p.x - q.x, p.z - q.z) > 1)) { best = score; point = p; }
    }
    if (point) chosen.push(point);
  }
  cache.set(map, chosen); return chosen;
}
export function canCollectWeapon(player: { x: number; y: number; z: number; side: string; alive: boolean }, pickup: WeaponPickup, map: MapData): boolean {
  if (!player.alive || !pickup.active || !validWeaponId(pickup.weapon) || pickup.weapon === 'solder' || player.side !== pickup.side) return false;
  const delta = [pickup.x - player.x, pickup.y + PLAYER.eye - player.y - PLAYER.eye, pickup.z - player.z];
  const distance = Math.hypot(...delta);
  if (!Number.isFinite(distance) || distance > WEAPON_PICKUPS.radius || Math.abs(player.y - pickup.y) > .75) return false;
  if (distance < .001) return true;
  const ray = { origin: [player.x, player.y + PLAYER.eye, player.z] as [number, number, number], direction: delta.map(v => v / distance) as [number, number, number] };
  return !surfaceMap(map, player.side as BoardSide).boxes.some(b => rayBox(ray, b) < distance);
}

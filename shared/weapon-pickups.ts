import { PLAYER, rayBox, surfaceMap, type MapData, type BoardSide } from './game.js';
import { validWeaponId } from './weapons.js';
export const WEAPON_PICKUPS = { radius: 1.5, respawnSeconds: 15 } as const;
export type WeaponPickup = { x: number; y: number; z: number; side: string; weapon: string; active: boolean; version: number };
type Point = { x: number; y: number; z: number; side: BoardSide };
export function weaponPickupLocations(map: MapData, seed = Math.floor(Math.random() * 0xffffffff)): Point[] {
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
  // Nine independent placements, not clusters. The server supplies a per-room
  // random seed; tests can provide a fixed seed to reproduce an arrangement.
  seed = (seed >>> 0) || 1;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const valid = (p: Point) =>
    Math.abs(p.x) <= map.width / 2 - .9 && Math.abs(p.z) <= map.depth / 2 - .9 &&
    !surfaceMap(map, p.side).boxes.some(b => b.max[1] > p.y + .3 && b.min[1] < p.y + 1.1 &&
      p.x + .9 > b.min[0] && p.x - .9 < b.max[0] && p.z + .9 > b.min[2] && p.z - .9 < b.max[2]);
  const available: Record<BoardSide, Point[]> = {
    front: (regions.front ?? []).filter(valid),
    back: (regions.back ?? []).filter(valid),
  };
  const chosen: Point[] = [];
  const mapScale = Math.min(map.width, map.depth);
  const minAny = Math.max(1.8, mapScale * .075);
  const minSame = Math.max(minAny, mapScale * .20);
  // IDs 0,3,6 are Iron; 1,4,7 are Hot Air; 2,5,8 are Pump.
  // On two-sided boards, alternate surfaces so guns occupy the whole board.
  for (let i = 0; i < 9; i++) {
    const side: BoardSide = i % 2 === 1 && available.back.length ? 'back' : 'front';
    const candidates = available[side];
    if (!candidates.length) continue;
    const same = chosen.filter((p, j) => p.side === side && j % 3 === i % 3);
    const ranked = candidates.map(p => {
      const spacing = (points: Point[]) => points.length
        ? Math.min(...points.map(q => Math.hypot(p.x - q.x, p.z - q.z))) : mapScale;
      return { p, any: spacing(chosen.filter(q => q.side === side)), own: spacing(same) };
    }).filter(v => v.any >= 1.8);
    if (!ranked.length) continue;
    // Prefer wide separation, with extra priority on duplicates of one weapon.
    // If a narrow map cannot satisfy the target spacing, use the best available.
    const spacious = ranked.filter(v => v.any >= minAny && v.own >= minSame);
    const pool = spacious.length ? spacious : ranked;
    pool.sort((a, b) => (b.any + b.own * 1.5) - (a.any + a.own * 1.5));
    const shortlist = Math.max(1, Math.ceil(pool.length * .03));
    chosen.push(pool[Math.floor(random() * shortlist)].p);
  }
  return chosen;

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

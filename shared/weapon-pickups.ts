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
  // Three spread-out clusters, each with one of every special weapon.
  // Seeded by map identity/geometry: varied between PCB maps, stable for all clients
  // and room instances using the same map.
  let seed = 2166136261;
  for (const char of `${map.id}:${map.width}:${map.depth}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
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
  const centers: Point[] = [];
  for (let cluster = 0; cluster < 3; cluster++) {
    const side: BoardSide = cluster === 1 && available.back.length >= 3 ? 'back' : 'front';
    const candidates = available[side];
    if (!candidates.length) continue;
    // Choose a seeded candidate among the widely separated positions.
    const scored = candidates.map(p => ({
      p,
      distance: centers.filter(c => c.side === side).reduce(
        (min, c) => Math.min(min, Math.hypot(c.x - p.x, c.z - p.z)), Infinity),
    }));
    scored.sort((a, b) => b.distance - a.distance);
    const anchor = scored[Math.floor(random() * Math.min(scored.length, Math.max(1, Math.ceil(scored.length * .12))))].p;
    centers.push(anchor);
    const local = candidates.filter(p =>
      Math.hypot(p.x - anchor.x, p.z - anchor.z) <= 6 &&
      chosen.filter(q => q.side === side).every(q => Math.hypot(p.x - q.x, p.z - q.z) >= 1.8));
    // The first item in each cluster is close to the anchor; the rest are
    // distributed within a short walking distance, never overlapping.
    for (let weapon = 0; weapon < 3; weapon++) {
      const options = local.filter(p => chosen.filter(q => q.side === side).every(q =>
        Math.hypot(p.x - q.x, p.z - q.z) >= 1.8));
      const fallback = candidates.filter(p => chosen.filter(q => q.side === side).every(q =>
        Math.hypot(p.x - q.x, p.z - q.z) >= 1.8));
      const pool = options.length ? options : fallback;
      if (!pool.length) break;
      pool.sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z));
      const point = pool[Math.floor(random() * Math.min(pool.length, Math.max(1, Math.ceil(pool.length * .4))))];
      chosen.push(point);
    }
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

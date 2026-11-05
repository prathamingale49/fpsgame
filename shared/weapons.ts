import { WEAPON, aimRay, hitscan, rayBox, surfaceMap, COMBAT, type Ray, type Motion, type MapData, type BoardSide, type PlayerTuning } from './game.js';

export const WEAPONS = {
  solder: { ...WEAPON, id: 'solder', mode: 'auto' },
  iron: { id: 'iron', name: 'Precision Iron', mode: 'charge', damage: 25, magazine: 5, reserve: 30, fireInterval: .8, reloadSeconds: 2.5, range: 150 },
  sniper: { id: 'sniper', name: 'Capacitor Sniper', mode: 'single', damage: 100, magazine: 1, reserve: 1, fireInterval: .15, reloadSeconds: 2.5, range: 150 },
  air: { id: 'air', name: 'Hot Air Rework Gun', mode: 'heat', damage: 10, magazine: 0, reserve: 0, fireInterval: .1, reloadSeconds: 0, range: 5 },
  pump: { id: 'pump', name: 'Desoldering Pump', mode: 'pellets', damage: 12, magazine: 6, reserve: 36, fireInterval: 1, reloadSeconds: 2, range: 12 },
} as const;
export type WeaponId = keyof typeof WEAPONS;
export function weaponKillMessage(id: WeaponId, attacker: string, target: string): string {
  const verb = { solder: 'reflowed', iron: 'soldered', air: 'heat-gunned', pump: 'desoldered', sniper: 'shorted' }[id];
  return `${attacker} ${verb} ${target} with a ${WEAPONS[id].name}`;
}
export const WEAPON_IDS: WeaponId[] = ['solder', 'iron', 'air', 'pump', 'sniper'];
export const CHARGE = { minimum: 0, full: 1 } as const;
export const HEAT = { duration: 3, cooling: 2, pulse: .1, halfAngle: 17.5 * Math.PI / 180, lease: .45 } as const;
export function validWeaponId(value: unknown): value is WeaponId { return typeof value === 'string' && Object.hasOwn(WEAPONS, value); }
export function ironDamage(seconds: number): number { return 25 + 65 * Math.min(1, Math.max(0, seconds)); }
export function airDamage(distance: number): number { return distance > 5 ? 0 : distance <= 3 ? 10 : 10 - (distance - 3) * 2.5; }
export function sniperAim(yaw: number, pitch: number, scoped: boolean, random = Math.random): [number, number] {
  if (scoped) return [yaw, pitch];
  const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * .035;
  return [yaw + Math.cos(angle) * radius, pitch + Math.sin(angle) * radius];
}
export function pumpRays(x: number, y: number, z: number, yaw: number, pitch: number, tuning: PlayerTuning): Ray[] {
  // Fixed, symmetric pattern; neither client randomness nor frame rate affects pellets.
  const spread = .075;
  return Array.from({ length: 8 }, (_, i) => { const angle = i * Math.PI / 4; return aimRay(x, y, z, yaw + Math.cos(angle) * spread, pitch + Math.sin(angle) * spread, tuning); });
}
export function weaponHits(id: WeaponId, ray: Ray, rays: Ray[], map: MapData, players: [string, Motion][], shooter: string, tuning: PlayerTuning, side: BoardSide, damage: number) {
  const hits = new Map<string, number>();
  const traces: { from: number[]; to: number[]; hit?: string }[] = [];
  const config = WEAPONS[id];
  if (id === 'air') {
    for (const [target, p] of players) {
      if (target === shooter || (p.side ?? 'front') !== side) continue;
      const delta = [p.x - ray.origin[0], p.y + tuning.eye - ray.origin[1], p.z - ray.origin[2]];
      const distance = Math.hypot(...delta);
      if (distance > config.range + tuning.radius * COMBAT.hitRadiusScale || distance < 1e-6) continue;
      const direction = delta.map(v => v / distance) as Ray['direction'];
      const angularRadius = Math.asin(Math.min(1, tuning.radius * COMBAT.hitRadiusScale / distance));
      if (direction.reduce((sum, v, i) => sum + v * ray.direction[i], 0) < Math.cos(HEAT.halfAngle + angularRadius)) continue;
      const sight = { origin: ray.origin, direction };
      if (surfaceMap(map, side).boxes.some(box => rayBox(sight, box) < distance)) continue;
      // A ray dipping below the substrate cannot damage through the board.
      if (p.y + tuning.eye < map.ground || ray.origin[1] < map.ground) continue;
      const amount = airDamage(Math.max(0, distance - tuning.radius * COMBAT.hitRadiusScale));
      if (amount > 0) hits.set(target, amount);
    }
    traces.push({ from: ray.origin, to: ray.origin.map((v, i) => v + ray.direction[i] * config.range) });
  } else for (const pellet of rays) {
    const result = hitscan(pellet, map, players, shooter, tuning, side, config.range);
    traces.push({ from: pellet.origin, to: pellet.origin.map((v, i) => v + pellet.direction[i] * result.distance), hit: result.target });
    if (result.target) hits.set(result.target, (hits.get(result.target) ?? 0) + damage);
  }
  return { hits, traces };
}

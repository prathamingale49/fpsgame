import { rayBox, surfaceMap, type BoardSide, type MapData } from '../shared/game.js';
export type DamageFeedback = { target: string; shooter: string; amount: number; side: BoardSide; x: number; y: number; z: number; eliminated: boolean };
export type DamageNumber = DamageFeedback & { born: number; updated: number };
export function mergeDamageNumber<T extends DamageNumber>(numbers: T[], hit: DamageFeedback, now: number): T | undefined {
  const number = numbers.find(n => n.target === hit.target && n.side === hit.side && now - n.updated < 200 && now - n.born < 700);
  if (number) { number.amount += hit.amount; number.eliminated ||= hit.eliminated; number.updated = now; number.x = hit.x; number.y = hit.y; number.z = hit.z; }
  return number;
}
export function damageNumberVisible(map: MapData, side: BoardSide, hitSide: BoardSide, eye: [number, number, number], head: [number, number, number]): boolean {
  if (side !== hitSide || eye[1] < map.ground || head[1] < map.ground) return false;
  const delta = head.map((v, i) => v - eye[i]), distance = Math.hypot(...delta);
  if (distance < .001) return true;
  const ray = { origin: eye, direction: delta.map(v => v / distance) as [number, number, number] };
  return !surfaceMap(map, side).boxes.some(box => rayBox(ray, box) < distance - .01);
}

import { expect, it } from 'vitest';
import { WEAPONS, ironDamage, sniperAim, airDamage, pumpRays, weaponHits, validWeaponId } from '../shared/weapons.js';
import { PLAYER, aimRay, initialMotion, testMap } from '../shared/game.js';

const map = { ...testMap, boxes: [] };
const ray = aimRay(0, 0, 0, 0, 0);
const target = (x: number, z: number) => initialMotion([x, 0, z]);
it('keeps scoped sniper aim exact and bounds server-generated hip spread', () => {
  expect(sniperAim(.2, -.1, true)).toEqual([.2, -.1]);
  for (let i = 0; i < 100; i++) {
    const [yaw, pitch] = sniperAim(.2, -.1, false);
    expect(Math.hypot(yaw - .2, pitch + .1)).toBeLessThanOrEqual(.03500001);
  }
  expect(sniperAim(0, 0, false, () => .5)).not.toEqual([0, 0]);
  expect(weaponHits('sniper', ray, [ray], map, [['npc', target(0, -140)]], 'me', PLAYER, 'front', 100).hits.get('npc')).toBe(100);
});
it('uses server charge thresholds and bounded damage', () => {
  expect(ironDamage(0)).toBe(25); expect(ironDamage(-1)).toBe(25);
  expect(ironDamage(.5)).toBe(57.5);
  expect(ironDamage(1)).toBe(90); expect(ironDamage(100)).toBe(90);
});
it('defines unchanged solder balance and validates weapon IDs', () => {
  expect(WEAPONS.solder).toMatchObject({ damage: 25, magazine: 30, fireInterval: .1, reloadSeconds: 1.7, range: 130 });
  expect(validWeaponId('iron')).toBe(true); expect(validWeaponId('__proto__')).toBe(false); expect(validWeaponId(3)).toBe(false);
});
it('tapers hot air from 100 to 50 DPS, with a hard range limit', () => {
  expect(airDamage(3)).toBe(10); expect(airDamage(4)).toBe(7.5); expect(airDamage(5)).toBe(5); expect(airDamage(5.01)).toBe(0);
});
it('generates eight repeatable spread-controlled pellets', () => {
  const rays = pumpRays(0, 0, 0, 0, 0, PLAYER);
  expect(rays).toHaveLength(8); expect(rays).toEqual(pumpRays(0, 0, 0, 0, 0, PLAYER));
  expect(new Set(rays.map(r => JSON.stringify(r.direction))).size).toBe(8);
  const result = weaponHits('pump', ray, rays, map, [['npc', target(0, -1)]], 'me', PLAYER, 'front', 12);
  expect(result.hits.get('npc')).toBe(96);
});
it('extends iron range without changing solder and limits pump range', () => {
  expect(weaponHits('iron', ray, [ray], map, [['npc', target(0, -140)]], 'me', PLAYER, 'front', 100).hits.get('npc')).toBe(100);
  expect(weaponHits('solder', ray, [ray], map, [['npc', target(0, -140)]], 'me', PLAYER, 'front', 25).hits.size).toBe(0);
  expect(weaponHits('pump', ray, [ray], map, [['npc', target(0, -13)]], 'me', PLAYER, 'front', 12).hits.size).toBe(0);
});
for (const id of ['air', 'iron', 'pump'] as const) it(`${id} respects geometry and opposite PCB sides`, () => {
  const players: [string, ReturnType<typeof initialMotion>][] = [['npc', target(0, -3)]];
  expect(weaponHits(id, ray, [ray], map, players, 'me', PLAYER, 'front', 50).hits.size).toBe(1);
  const blocked = { ...map, boxes: [{ min: [-1, 0, -2] as [number, number, number], max: [1, 2, -1] as [number, number, number] }] };
  expect(weaponHits(id, ray, [ray], blocked, players, 'me', PLAYER, 'front', 50).hits.size).toBe(0);
  players[0][1].side = 'back'; expect(weaponHits(id, ray, [ray], map, players, 'me', PLAYER, 'front', 50).hits.size).toBe(0);
});
it('bounds the hot air cone angle and range', () => {
  expect(weaponHits('air', ray, [ray], map, [['side', target(3, -3)], ['far', target(0, -6)]], 'me', PLAYER, 'front', 10).hits.size).toBe(0);
});

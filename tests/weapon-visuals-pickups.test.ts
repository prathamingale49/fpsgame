import { expect, it } from 'vitest';
import { createWeaponModel, animateWeapon, type WeaponAnimation } from '../client/weapon-models.js';
import { weaponPickupLocations, canCollectWeapon } from '../shared/weapon-pickups.js';
import { WEAPON_IDS, weaponKillMessage } from '../shared/weapons.js';
import { testMap } from '../shared/game.js';
import fs from 'node:fs';
const input: WeaponAnimation = { dt: 1 / 60, active: true, enabled: true, charge: 0, heat: 0, firing: false, overheated: false, reloading: false, moving: false, fireAt: 0 };
it('builds four distinct reusable models with recognizably different parts', () => {
  const models = WEAPON_IDS.map(createWeaponModel);
  expect(new Set(models.map(m => m.root.name)).size).toBe(4);
  expect(models[1].coils).toHaveLength(6); expect(models[2].fan.children).toHaveLength(5);
  expect(models[3].plunger.children.length).toBeGreaterThan(8);
  expect(new Set(models.map(m => m.root.children.length)).size).toBeGreaterThan(2);
});
it('charges proportionally, lights coils, retracts and resets on cancellation', () => {
  const m = createWeaponModel('iron');
  for (let i = 0; i < 60; i++) animateWeapon(m, { ...input, charge: .5 });
  const partial = m.root.position.z; expect(partial).toBeGreaterThan(.1); expect(m.barrel.position.z).toBeCloseTo(.08);
  for (let i = 0; i < 60; i++) animateWeapon(m, { ...input, charge: 1 });
  expect(m.root.position.z).toBeGreaterThan(partial); expect(m.coils.every(c => c.material.emissiveIntensity >= 3)).toBe(true);
  animateWeapon(m, { ...input, charge: 1, enabled: false }); expect(m.root.position.z).toBe(0); expect(m.barrel.position.z).toBe(0);
  animateWeapon(m, { ...input, active: false }); expect(m.root.visible).toBe(false);
});
it('animates recoil, fan, plunger and reload without allocating geometry or changing aim input', () => {
  const m = createWeaponModel('pump'), geometry = m.flash.geometry, original = { ...input, fireAt: 100 };
  animateWeapon(m, original); expect(m.plunger.position.z).toBeLessThan(0); expect(m.flash.visible).toBe(true);
  animateWeapon(m, { ...input, reloading: true }); expect(m.root.rotation.x).toBeLessThan(0);
  expect(m.flash.geometry).toBe(geometry); expect(original).toEqual({ ...input, fireAt: 100 });
  const air = createWeaponModel('air'); animateWeapon(air, { ...input, firing: true, heat: 1 }); expect(air.fan.rotation.z).toBeGreaterThan(0);
});
it('places deterministic distinct pickups on clear bounded map surfaces', () => {
  const map = { ...testMap, back: { enabled: true, thickness: 1.6, boxes: testMap.boxes } };
  const points = weaponPickupLocations(map); expect(points).toHaveLength(3); expect(points).toEqual(weaponPickupLocations(map));
  expect(points.some(p => p.side === 'back')).toBe(true);
  for (const p of points) {
    expect(Math.abs(p.x)).toBeLessThan(map.width / 2); expect(Math.abs(p.z)).toBeLessThan(map.depth / 2);
    expect(canCollectWeapon({ ...p, alive: true }, { ...p, weapon: 'iron', active: true, version: 0 }, map)).toBe(true);
  }
});
it('rejects distant dead inactive invalid and opposite-side pickup interactions', () => {
  const p = { x: 0, y: 0, z: 0, side: 'front', alive: true }, pickup = { ...p, weapon: 'pump', active: true, version: 0 };
  expect(canCollectWeapon(p, pickup, testMap)).toBe(true);
  for (const changes of [{ x: 5 }, { side: 'back' }, { active: false }, { weapon: 'solder' }, { weapon: 'bogus' }]) expect(canCollectWeapon(p, { ...pickup, ...changes }, testMap)).toBe(false);
  expect(canCollectWeapon({ ...p, alive: false }, pickup, testMap)).toBe(false);
});
it('gives each gun its own electronics-themed kill message', () => {
  const messages = WEAPON_IDS.map(id => weaponKillMessage(id, 'Alice', 'Target'));
  expect(new Set(messages).size).toBe(4); expect(messages.every(m => m.includes('Alice') && m.includes('Target'))).toBe(true);
  expect(messages[0]).toContain('reflowed'); expect(messages[3]).toContain('desoldered');
});
it('places all three pickups safely on the actual BMS map', () => {
  const map = JSON.parse(fs.readFileSync('assets/public/maps/bms.json', 'utf8'));
  const points = weaponPickupLocations(map); expect(points).toHaveLength(3);
  for (const p of points) expect(canCollectWeapon({ ...p, alive: true }, { ...p, weapon: 'iron', active: true, version: 0 }, map)).toBe(true);
});

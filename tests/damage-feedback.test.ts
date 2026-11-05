import { expect, it } from 'vitest';
import { mergeDamageNumber, damageNumberVisible, type DamageNumber } from '../client/damage-feedback.js';
import { testMap } from '../shared/game.js';
const hit = { target: 'target', shooter: 'me', amount: 10, side: 'front' as const, x: 0, y: 0, z: -3, eliminated: false };
it('coalesces rapid damage per target without extending the one-second life indefinitely', () => {
  const numbers: DamageNumber[] = [{ ...hit, born: 0, updated: 0 }];
  expect(mergeDamageNumber(numbers, hit, 100)?.amount).toBe(20);
  expect(mergeDamageNumber(numbers, { ...hit, eliminated: true }, 180)?.eliminated).toBe(true);
  expect(mergeDamageNumber(numbers, { ...hit, target: 'other' }, 190)).toBeUndefined();
  expect(mergeDamageNumber(numbers, { ...hit, side: 'back' }, 190)).toBeUndefined();
  expect(mergeDamageNumber(numbers, hit, 800)).toBeUndefined();
  expect(numbers[0].born).toBe(0);
});
it('hides opposite-side, below-board and geometry-occluded feedback', () => {
  const map = { ...testMap, boxes: [] };
  expect(damageNumberVisible(map, 'front', 'front', [0, 1, 0], [0, 2, -3])).toBe(true);
  expect(damageNumberVisible(map, 'front', 'back', [0, 1, 0], [0, 2, -3])).toBe(false);
  expect(damageNumberVisible(map, 'front', 'front', [0, -1, 0], [0, 2, -3])).toBe(false);
  expect(damageNumberVisible({ ...map, boxes: [{ min: [-2, 0, -2], max: [2, 3, -1] }] }, 'front', 'front', [0, 1, 0], [0, 2, -3])).toBe(false);
});

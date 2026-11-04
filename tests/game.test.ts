import { describe, expect, it } from 'vitest';
import { aimRay, hitscan, initialMotion, PLAYER, rayBox, stepMotion, testMap, TICK, WEAPON, type Input } from '../shared/game';

const input: Input = { seq: 1, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false };
describe('movement', () => {
  it('moves forward consistently over fixed ticks', () => {
    let m = initialMotion([0, 0, 0]);
    for (let i = 0; i < 60; i++) m = stepMotion(m, input, testMap, TICK);
    expect(m.z).toBeCloseTo(-PLAYER.walkSpeed, 3); expect(m.y).toBe(0);
  });
  it('lands after jumping and does not leave the board', () => {
    let m = stepMotion(initialMotion([0, 0, 0]), { ...input, forward: 0, jump: true }, testMap);
    expect(m.y).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) m = stepMotion(m, { ...input, forward: 0, jump: false }, testMap);
    expect(m.grounded).toBe(true); expect(m.y).toBe(0);
    m = initialMotion([testMap.width / 2 - .5, 0, 0]);
    for (let i = 0; i < 60; i++) m = stepMotion(m, { ...input, forward: 0, strafe: 1 }, testMap);
    expect(m.x).toBeLessThan(testMap.width / 2);
  });
  it('blocks against components', () => {
    let m = initialMotion([-24, 0, -15]);
    for (let i = 0; i < 120; i++) m = stepMotion(m, input, testMap);
    expect(m.z).toBeGreaterThan(-18);
  });
  it('can jump onto a large component', () => {
    const map = { ...testMap, boxes: [{ min: [-2, 0, -5] as [number, number, number], max: [2, 2.5, -2] as [number, number, number] }] };
    let m = initialMotion([0, 0, 0]);
    for (let i = 0; i < 18; i++) m = stepMotion(m, { ...input, jump: i === 0 }, map);
    expect(m.z).toBeLessThan(-2);
    for (let i = 0; i < 90; i++) m = stepMotion(m, { ...input, forward: 0 }, map);
    expect(m.y).toBeCloseTo(2.5, 2); expect(m.grounded).toBe(true);
  });
  it('normalizes diagonal movement and stops on release', () => {
    const map = { ...testMap, boxes: [] };
    const forward = stepMotion(initialMotion([0, 0, 0]), input, map);
    const diagonal = stepMotion(initialMotion([0, 0, 0]), { ...input, strafe: 1 }, map);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(Math.abs(forward.z), 5);
    const stopped = stepMotion(diagonal, { ...input, forward: 0, strafe: 0 }, map);
    expect(stopped.x).toBe(diagonal.x); expect(stopped.z).toBe(diagonal.z);
  });
  it('slides along walls without tunneling through narrow gaps', () => {
    const map = { ...testMap, boxes: [{ min: [-.2, 0, -4] as [number, number, number], max: [.2, 3, 4] as [number, number, number] }] };
    let m = initialMotion([-.8, 0, 0]);
    for (let i = 0; i < 20; i++) m = stepMotion(m, { ...input, forward: 1, strafe: 1 }, map);
    expect(m.x).toBeLessThan(-.2); expect(m.z).toBeLessThan(-1);
  });
  it('uses nearby collision candidates in dense maps', () => {
    const boxes = Array.from({ length: 1000 }, (_, i) => ({ min: [20 + i * 2, 0, 20] as [number, number, number], max: [21 + i * 2, 2, 21] as [number, number, number] }));
    const map = { ...testMap, boxes };
    const stats = { collisionChecks: 0 };
    stepMotion(initialMotion([0, 0, 0]), input, map, TICK, stats);
    expect(stats.collisionChecks).toBeLessThan(10);
  });
});
describe('combat', () => {
  it('hits player before distant geometry', () => {
    const map = { ...testMap, boxes: [] };
    const ray = aimRay(0, 0, 0, 0, 0);
    const hit = hitscan(ray, map, [['a', initialMotion([0, 0, 0])], ['b', initialMotion([0, 0, -10])]], 'a');
    expect(hit.target).toBe('b'); expect(hit.distance).toBeLessThan(WEAPON.range);
  });
  it('blocks shots through solid objects', () => {
    const map = { ...testMap, boxes: [{ min: [-1, 0, -5] as [number, number, number], max: [1, 5, -4] as [number, number, number] }] };
    const hit = hitscan(aimRay(0, 0, 0, 0, 0), map, [['b', initialMotion([0, 0, -10])]], 'a');
    expect(hit.target).toBeUndefined(); expect(hit.distance).toBeCloseTo(4);
    expect(rayBox(aimRay(0, 0, 0, 0, 0), map.boxes[0])).toBeCloseTo(4);
  });
});

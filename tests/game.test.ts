import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { aimRay, collisionCacheStats, COMBAT, hitscan, initialMotion, JUMP_HEIGHT_RATIO, PLAYER, rayBox, rayPlayer, samplePosition, stepMotion, testMap, TICK, tuningForHeight, validDevHeight, validShotInput, WEAPON, type Input, type Motion, type MapData, type PositionSample } from '../shared/game';

const input: Input = { seq: 1, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false };
describe('movement', () => {
  it('uses the tested 0.90 mm scale in normal rooms without enabling debug mode', () => {
    expect(PLAYER.height).toBe(.9);
    expect(PLAYER.radius).toBeCloseTo(.18);
    expect(PLAYER.eye).toBeCloseTo(.77);
    expect(PLAYER.walkSpeed).toBeCloseTo(7);
    expect(PLAYER.sprintSpeed).toBeCloseTo(10);
    expect(PLAYER.jumpSpeed).toBeCloseTo(tuningForHeight(.9).jumpSpeed);
  });
  it('scales jump apex, hitbox, speed, and eye position with the development slider', () => {
    const empty = { ...testMap, boxes: [] };
    expect(tuningForHeight(PLAYER.height).jumpSpeed).toBeCloseTo(PLAYER.jumpSpeed, 10);
    for (const height of [.75, 1, 1.1, 1.25, 1.8, 2.25]) {
      const tuning = tuningForHeight(height);
      expect(tuning.radius).toBeCloseTo(PLAYER.radius * height / PLAYER.height, 10);
      expect(tuning.eye).toBeCloseTo(PLAYER.eye * height / PLAYER.height, 10);
      expect(tuning.walkSpeed).toBeCloseTo(PLAYER.walkSpeed * height / PLAYER.height, 10);
      let motion = initialMotion([0, 0, 0]), apex = 0;
      for (let tick = 0; tick < 120; tick++) {
        motion = stepMotion(motion, { ...input, forward: 0, jump: tick === 0 }, empty, TICK, undefined, tuning);
        apex = Math.max(apex, motion.y);
      }
      expect(apex).toBeCloseTo(JUMP_HEIGHT_RATIO * height, 1);
      expect(motion.grounded).toBe(true);
      expect(aimRay(0, 0, 0, 0, 0, tuning).origin[1]).toBeCloseTo(tuning.eye, 10);
      const aboveHead = { origin: [0, height + .1, 5] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
      expect(rayPlayer(aboveHead, initialMotion([0, 0, 0]), tuning)).toBe(Infinity);
    }
  });
  it('rejects invalid and out-of-range developer scale requests', () => {
    expect(validDevHeight(1.12)).toBe(1.1);
    expect(validDevHeight(1.1)).toBe(1.1);
    for (const value of [undefined, '1.1', NaN, Infinity, -.1, 0, .5, 3]) expect(validDevHeight(value)).toBeNull();
  });
  it('moves forward consistently over fixed ticks', () => {
    let m = initialMotion([0, 0, 0]);
    for (let i = 0; i < 60; i++) m = stepMotion(m, input, testMap, TICK);
    expect(m.z).toBeCloseTo(-PLAYER.walkSpeed, 3); expect(m.y).toBe(0);
  });
  it('lands after jumping, then falls beyond the PCB edge', () => {
    let m = stepMotion(initialMotion([0, 0, 0]), { ...input, forward: 0, jump: true }, testMap);
    expect(m.y).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) m = stepMotion(m, { ...input, forward: 0, jump: false }, testMap);
    expect(m.grounded).toBe(true); expect(m.y).toBe(0);
    m = initialMotion([testMap.width / 2 - .5, 0, 0]);
    for (let i = 0; i < 60; i++) m = stepMotion(m, { ...input, forward: 0, strafe: 1 }, testMap);
    expect(m.x).toBeGreaterThan(testMap.width / 2);
    for (let i = 0; i < 90; i++) m = stepMotion(m, { ...input, forward: 0, strafe: 0 }, testMap);
    expect(m.y).toBeLessThan(-PLAYER.fallDeathDepth);
    expect(m.grounded).toBe(false);
  });
  it('blocks against components', () => {
    let m = initialMotion([-24, 0, -15]);
    for (let i = 0; i < 120; i++) m = stepMotion(m, input, testMap);
    expect(m.z).toBeGreaterThan(-18);
  });
  it('can jump onto a large component', () => {
    const map = { ...testMap, boxes: [{ min: [-2, 0, -5] as [number, number, number], max: [2, 1.25, -2] as [number, number, number] }] };
    let m = initialMotion([0, 0, 0]);
    for (let i = 0; i < 36; i++) m = stepMotion(m, { ...input, jump: i === 0 }, map);
    expect(m.z).toBeLessThan(-2);
    for (let i = 0; i < 90; i++) m = stepMotion(m, { ...input, forward: 0 }, map);
    expect(m.y).toBeCloseTo(1.25, 2); expect(m.grounded).toBe(true);
  });
  it('retains connector mantling with empty rocket fuel and remains on top', () => {
    const map = { ...testMap, boxes: [{ min: [-3, 0, -6] as [number, number, number], max: [3, 4.25, -3] as [number, number, number], climbable: true, kind: 'connector' as const }] };
    let m: Motion = { ...initialMotion([0, 0, 0]), fuel: 0 };
    let climbed = false;
    for (let i = 0; i < 100; i++) {
      m = stepMotion(m, { ...input, forward: i < 25 ? 1 : 0, jump: true }, map);
      if (m.y >= 4.25) climbed = true;
    }
    expect(climbed).toBe(true);
    expect(m.y).toBeCloseTo(4.25, 3);
    expect(m.grounded).toBe(true);
    expect(m.z).toBeLessThan(-3);
    for (let i = 0; i < 50; i++) m = stepMotion(m, { ...input, forward: 0, jump: true }, map);
    expect(m.y).toBeCloseTo(4.25, 3);
    const shot = hitscan(aimRay(m.x, m.y, m.z, 0, 0), map, [['opponent', initialMotion([0, 4.25, m.z - 7])]], 'self');
    expect(shot.target).toBe('opponent');
  });
  it('keeps unmarked header cover solid for movement and shots', () => {
    const header = { min: [-2, 0, -5] as [number, number, number], max: [2, 5, -4] as [number, number, number], kind: 'header' as const };
    const map = { ...testMap, boxes: [header] };
    let m = initialMotion([0, 0, 0]);
    for (let i = 0; i < 90; i++) m = stepMotion(m, { ...input, jump: i === 0 }, map);
    expect(m.z).toBeGreaterThan(-4);
    expect(hitscan(aimRay(0, 0, 0, 0, 0), map, [['opponent', initialMotion([0, 0, -10])]], 'self').target).toBeUndefined();
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
  it('bounds cached cross-cell collision queries during long traversal', () => {
    const map = { ...testMap, width: 4000, depth: 200, boxes: Array.from({ length: 1000 }, (_, i) => ({ min: [i * 3, 0, -4] as [number, number, number], max: [i * 3 + 1, 2, -3] as [number, number, number] })) };
    for (let i = 0; i < 800; i++) stepMotion(initialMotion([i * 2, 0, 0]), { ...input, strafe: 1 }, map);
    expect(collisionCacheStats(map).queries).toBeLessThanOrEqual(256);
  });
});
describe('combat', () => {
  it('validates per-shot camera aim, sequence, and view timestamps', () => {
    const valid = { shotId: 1, seq: 17, yaw: Math.PI, pitch: -.22, viewTime: 123456789 };
    expect(validShotInput(valid)).toBe(true);
    for (const change of [{ pitch: Infinity }, { yaw: NaN }, { pitch: 2 }, { seq: -1 }, { shotId: 1.5 }, { viewTime: 'bad' }]) {
      expect(validShotInput({ ...valid, ...change })).toBe(false);
    }
  });
  it('enlarges only the shooting hitbox, leaving movement dimensions unchanged', () => {
    const opponent = initialMotion([0, 0, -5]);
    const inside = PLAYER.radius * 1.16;
    const outside = PLAYER.radius * (COMBAT.hitRadiusScale + .1);
    const straightRay = (x: number) => ({ origin: [x, PLAYER.eye, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] });
    expect(rayPlayer(straightRay(inside), opponent)).toBeLessThan(Infinity);
    expect(rayPlayer(straightRay(outside), opponent)).toBe(Infinity);
    expect(PLAYER.radius).toBeCloseTo(.18);
    expect(tuningForHeight(.9).radius).toBeCloseTo(.18);
  });
  it('interpolates a displayed moving target to the timestamp used for hit registration', () => {
    const samples: PositionSample[] = [
      { time: 1000, x: 0, y: 0, z: -5, side: 'front' },
      { time: 1100, x: 2, y: 0, z: -5, side: 'front' },
    ];
    const visible = samplePosition(samples, 1025)!;
    expect(visible.x).toBeCloseTo(.5);
    const map = { ...testMap, boxes: [] };
    const ray = { origin: [visible.x, PLAYER.eye, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
    expect(hitscan(ray, map, [['moving', { ...initialMotion([0, 0, 0]), ...visible }]], 'self').target).toBe('moving');
    expect(hitscan(ray, map, [['moving', { ...initialMotion([0, 0, 0]), ...samples[1] }]], 'self').target).toBeUndefined();
    expect(samplePosition(samples, 1200)!.x).toBe(2); // server never extrapolates hitboxes
    expect(samplePosition(samples, 1200, COMBAT.extrapolationMs)!.x).toBeCloseTo(2.7); // client visual cap
  });
  it('never interpolates through a side transition', () => {
    const samples: PositionSample[] = [
      { time: 1000, x: -8, y: 0, z: 3, side: 'front' },
      { time: 1050, x: 8, y: 0, z: -3, side: 'back' },
    ];
    expect(samplePosition(samples, 1025)!.side).toBe('front');
    expect(samplePosition(samples, 1025)!.x).toBe(-8);
    expect(samplePosition(samples, 1100, 30)!.side).toBe('back');
    expect(samplePosition(samples, 1100, 30)!.x).toBe(8);
  });
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
const bmsFile = 'assets/public/maps/bms.json';
describe.skipIf(!fs.existsSync(bmsFile))('imported BMS collision geometry', () => {
  const bms = fs.existsSync(bmsFile) ? JSON.parse(fs.readFileSync(bmsFile, 'utf8')) as MapData : testMap;
  it('turns each long header row into visible-sized cover that stops walking and shots', () => {
    const headers = bms.boxes.filter(b => b.kind === 'header');
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.max[0] - header.min[0]).toBeGreaterThan(50);
      expect(header.max[2] - header.min[2]).toBeLessThan(6);
      expect(header.climbable).toBeFalsy();
      const map = { ...bms, boxes: [header] };
      const x = (header.min[0] + header.max[0]) / 2;
      const fromPositive = header.max[2] + 3 < map.depth / 2 - 1;
      const z = fromPositive ? header.max[2] + 3 : header.min[2] - 3, yaw = fromPositive ? 0 : Math.PI;
      let player = initialMotion([x, 0, z]);
      for (let i = 0; i < 90; i++) player = stepMotion(player, { ...input, yaw }, map);
      expect(fromPositive ? player.z > header.max[2] : player.z < header.min[2]).toBe(true);
      const targetZ = fromPositive ? header.min[2] - 3 : header.max[2] + 3;
      const hit = hitscan(aimRay(x, 0, z, yaw, 0), map, [['target', initialMotion([x, 0, targetZ])]], 'shooter');
      expect(hit.target).toBeUndefined();
    }
  });
  it('preserves J6 mantle scale limits without rocket fuel', () => {
    const connector = bms.boxes.find(b => b.name === 'J6');
    expect(connector?.climbable).toBe(true);
    const map = { ...bms, boxes: [connector!] };
    const x = (connector!.min[0] + connector!.max[0]) / 2;
    const spawn: [number, number, number] = [x, 0, connector!.max[2] + 3];
    let smallPlayer: Motion = { ...initialMotion(spawn), fuel: 0 };
    for (let i = 0; i < 100; i++) smallPlayer = stepMotion(smallPlayer, { ...input, forward: i < 40 ? 1 : 0, jump: true }, map);
    expect(smallPlayer.y).toBe(0);
    expect(smallPlayer.z).toBeGreaterThan(connector!.max[2]);

    const referenceTuning = tuningForHeight(1.8);
    let referencePlayer: Motion = { ...initialMotion(spawn), fuel: 0 };
    for (let i = 0; i < 100; i++) referencePlayer = stepMotion(referencePlayer, { ...input, forward: i < 40 ? 1 : 0, jump: true }, map, TICK, undefined, referenceTuning);
    expect(referencePlayer.y).toBeCloseTo(connector!.max[1], 2);
    expect(referencePlayer.grounded).toBe(true);
  });
});

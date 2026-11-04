import { describe, expect, it } from 'vitest';
import { isCollidableComponent } from '../tools/collision-rules';
import { initialMotion, PLAYER, stepMotion, TICK, testMap, type Box, type Input } from '../shared/game';

const idle: Input = { seq: 0, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false };

describe('small PCB component collisions', () => {
  it('imports 0402 and 0603 packages but excludes thin copper and oversized envelopes', () => {
    const boardArea = 100 * 70;
    expect(isCollidableComponent(.35, 1.0, .5, boardArea)).toBe(true); // 0402
    expect(isCollidableComponent(.45, 1.6, .8, boardArea)).toBe(true); // 0603
    expect(isCollidableComponent(.1, 1.0, .5, boardArea)).toBe(false); // copper pad
    expect(isCollidableComponent(.4, .2, .2, boardArea)).toBe(false); // tiny detail
    expect(isCollidableComponent(5, 90, 55, boardArea)).toBe(false); // imported carrier assembly
  });

  for (const [name, width, depth, height] of [['0402', 1, .5, .35], ['0603', 1.6, .8, .45]] as const) {
    it(`blocks the normal 0.90 mm player against a ${name} package`, () => {
      const component: Box = { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2], name };
      const map = { ...testMap, boxes: [component] };
      let player = initialMotion([0, 0, 2]);
      for (let i = 0; i < 60; i++) player = stepMotion(player, idle, map, TICK);
      expect(PLAYER.height).toBe(.9);
      expect(player.z).toBeGreaterThanOrEqual(component.max[2] + PLAYER.radius - PLAYER.walkSpeed * TICK - .001);
      expect(player.z).toBeLessThan(2);
      expect(player.grounded).toBe(true);
    });
  }
});

import { expect, it } from 'vitest';
import { initialMotion, PLAYER, testMap, transitionEdge, type MapData, type BoardSide } from '../shared/game.js';

const map: MapData = { ...testMap, back: { enabled: true, thickness: 1.6, boxes: [] } };
for (const side of ['front', 'back'] as BoardSide[]) for (const [x, z] of [[51, 12], [-51, 12], [12, 37], [12, -37]]) {
  it(`transitions ${side} at ${x},${z} preserving physical edge position`, () => {
    const result = transitionEdge({ ...initialMotion([x, 0, z]), side }, map, PLAYER);
    expect(result.side).toBe(side === 'front' ? 'back' : 'front');
    expect(Math.abs(result.x)).toBeLessThan(map.width / 2);
    expect(Math.abs(result.z)).toBeLessThan(map.depth / 2);
    if (Math.abs(x) < 50) expect(result.x).toBe(x);
    if (Math.abs(z) < 36) expect(result.z).toBe(-z);
    expect(result.transitionCooldown).toBeGreaterThan(0);
  });
}
it('places the player above the highest obstructing component', () => {
  const obstructed: MapData = { ...map, back: { ...map.back!, boxes: [{ min: [48, 0, -15], max: [50, 8, -10] }] } };
  expect(transitionEdge(initialMotion([51, 0, 12]), obstructed, PLAYER).y).toBeGreaterThan(8);
});
it('leaves legacy maps and cooldown moves unchanged', () => {
  const motion = initialMotion([51, -1, 12]);
  expect(transitionEdge(motion, testMap, PLAYER)).toBe(motion);
  const cooldown = { ...motion, transitionCooldown: .1 };
  expect(transitionEdge(cooldown, map, PLAYER)).toBe(cooldown);
});

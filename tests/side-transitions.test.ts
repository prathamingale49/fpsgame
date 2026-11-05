import { expect, it } from 'vitest';
import { initialMotion, EDGE_FLIP_SECONDS, PLAYER, testMap, transitionEdge, stepMotion, hitscan, aimRay, TICK, type MapData, type BoardSide } from '../shared/game.js';

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
it('uses independent movement collisions for each surface', () => {
  const wall = { min: [-2, 0, -2] as [number, number, number], max: [2, 4, -1] as [number, number, number] };
  const separate = { ...map, boxes: [wall] };
  let front = initialMotion([0, 0, 0]);
  let back = { ...front, side: 'back' as BoardSide };
  for (let i = 0; i < 60; i++) {
    const input = { seq: i, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false };
    front = stepMotion(front, input, separate); back = stepMotion(back, input, separate) as typeof back;
  }
  expect(front.z).toBeGreaterThan(-1);
  expect(back.z).toBeLessThan(-6);
});
it('leaves legacy maps and cooldown moves unchanged', () => {
  const motion = initialMotion([51, -1, 12]);
  expect(transitionEdge(motion, testMap, PLAYER)).toBe(motion);
  const cooldown = { ...motion, transitionCooldown: .1 };
  expect(transitionEdge(cooldown, map, PLAYER).side).toBe('front');
  expect(transitionEdge(cooldown, map, PLAYER).x).toBeLessThan(50);
});
it('holds the player at the landing point until the flip finishes, even when sprinting and jumping', () => {
  let motion = transitionEdge(initialMotion([51, 0, 12]), map, PLAYER);
  expect(motion.side).toBe('back');
  expect(motion.transitionCooldown).toBe(EDGE_FLIP_SECONDS);
  const landing = [motion.x, motion.y, motion.z];
  const lockedTicks = Math.ceil(EDGE_FLIP_SECONDS / TICK);
  for (let i = 0; i < lockedTicks; i++) {
    motion = stepMotion(motion, { seq: i + 1, forward: 1, strafe: 1, yaw: 0, pitch: 0, jump: true, sprint: true }, map);
    expect([motion.x, motion.y, motion.z]).toEqual(landing);
    expect(motion.side).toBe('back');
  }
  expect(motion.transitionCooldown).toBe(0);
  motion = stepMotion(motion, { seq: 100, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: true }, map);
  expect(Math.hypot(motion.x - landing[0], motion.z - landing[2])).toBeGreaterThan(0);
});
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) it(`sustains held movement inward after edge wrap at yaw ${yaw}`, () => {
  const empty = { ...map, width: 20, depth: 20, boxes: [] };
  let motion = initialMotion([-Math.sin(yaw) * 9.9, 0, -Math.cos(yaw) * 9.9]);
  const input = { seq: 1, forward: 1, strafe: 0, yaw, pitch: 0, jump: false, sprint: false };
  let transitions = 0;
  for (let i = 0; i < 90; i++) {
    const next = stepMotion(motion, input, empty);
    if (next.side !== motion.side) transitions++;
    motion = next;
  }
  expect(transitions).toBe(1);
  expect(motion.side).toBe('back');
  expect(Math.abs(motion.x)).toBeLessThan(9);
  expect(Math.abs(motion.z)).toBeLessThan(9);
});
it('filters opposite-side targets and selects the current surface geometry', () => {
  const target = { ...initialMotion([0, 0, -4]), side: 'back' as const };
  const empty = { ...map, boxes: [] };
  const ray = aimRay(0, 0, 0, 0, 0);
  expect(hitscan(ray, empty, [['other', target]], 'me').target).toBeUndefined();
  expect(hitscan(ray, empty, [['other', target]], 'me', PLAYER, 'back').target).toBe('other');
  expect(hitscan(ray, { ...empty, back: { ...empty.back!, boxes: [{ min: [-1, 0, -2], max: [1, 2, -1] }] } }, [['other', target]], 'me', PLAYER, 'back').target).toBeUndefined();
});
it('repeats front/back crossings indefinitely without changing motion invariants', () => {
  const empty = { ...map, width: 8, depth: 8, boxes: [] };
  let motion = initialMotion([0, 0, 0]);
  let wraps = 0;
  for (let i = 0; i < 4000; i++) {
    const next = stepMotion(motion, { seq: i, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: i % 100 < 10, sprint: true }, empty);
    if (next.side !== motion.side) wraps++;
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(next.y)).toBe(true);
    motion = next;
  }
  // The flip lock intentionally reduces the number of possible crossings.
  expect(wraps).toBeGreaterThanOrEqual(35);
});
it('resolves diagonal corner wraps without a sustained loop', () => {
  const empty = { ...map, width: 20, depth: 20, boxes: [] };
  let motion = initialMotion([9.9, 0, -9.9]);
  let wraps = 0;
  for (let i = 0; i < 90; i++) {
    const next = stepMotion(motion, { seq: i, forward: 1, strafe: 0, yaw: -Math.PI / 4, pitch: 0, jump: false, sprint: false }, empty);
    if (next.side !== motion.side) wraps++;
    motion = next;
  }
  expect(wraps).toBeLessThanOrEqual(2);
  expect(Math.abs(motion.x)).toBeLessThan(9.9);
  expect(Math.abs(motion.z)).toBeLessThan(9.9);
});

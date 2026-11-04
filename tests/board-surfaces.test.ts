import { describe, expect, it } from 'vitest';
import { bottomBox, makeBoardBack, type Bounds } from '../tools/board-surfaces.js';

const board: Bounds = { min: [10, 20, -2], max: [110, 100, -.4] };
describe('physical back surface extraction', () => {
  it('rotates around X using the physical substrate bottom and off-center origin', () => {
    expect(bottomBox({ min: [15, 30, -4], max: [17, 33, -2] }, board, 'R1')).toEqual({
      min: [-45, 0, -30], max: [-43, 2, -27], name: 'R1',
    });
  });
  it('rejects front-only components and thin copper', () => {
    expect(bottomBox({ min: [15, 30, -.4], max: [17, 33, 2] }, board)).toBeUndefined();
    expect(bottomBox({ min: [15, 30, -2.05], max: [17, 33, -2] }, board)).toBeUndefined();
  });
  it('clips through-hole geometry at the bottom surface', () => {
    expect(bottomBox({ min: [15, 30, -4], max: [17, 33, 2] }, board)?.min[1]).toBe(0);
  });
  it('requires multiple parts and meaningful coverage before enabling transitions', () => {
    const box = bottomBox({ min: [15, 30, -4], max: [17, 33, -2] }, board)!;
    expect(makeBoardBack([], 1.6, 8000).enabled).toBe(false);
    expect(makeBoardBack(Array(11).fill(box), 1.6, 100).enabled).toBe(false);
    expect(makeBoardBack(Array(12).fill(box), 1.6, 8000).enabled).toBe(false);
    expect(makeBoardBack(Array(20).fill(box), 1.6, 8000).enabled).toBe(true);
  });
});

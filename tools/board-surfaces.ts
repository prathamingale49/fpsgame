import type { Box, BoardBack } from '../shared/game.js';
import { isCollidableComponent } from './collision-rules.js';

export type Bounds = { min: [number, number, number]; max: [number, number, number] };

// Front: (X-cx, Z-top, cy-Y). Back is a proper 180-degree rotation
// around game X: (X-cx, bottom-Z, Y-cy). The substrate thickness is
// measured from STEP, not inferred from component heights.
export function bottomBox(bounds: Bounds, board: Bounds, name?: string): Box | undefined {
  const cx = (board.min[0] + board.max[0]) / 2;
  const cy = (board.min[1] + board.max[1]) / 2;
  const width = bounds.max[0] - bounds.min[0], depth = bounds.max[1] - bounds.min[1];
  const height = board.min[2] - bounds.min[2];
  // Components crossing the substrate (pins, screws) may extend below it.
  if (!isCollidableComponent(height, width, depth, (board.max[0] - board.min[0]) * (board.max[1] - board.min[1]))) return undefined;
  return { min: [bounds.min[0] - cx, Math.max(0, board.min[2] - bounds.max[2]), bounds.min[1] - cy],
    max: [bounds.max[0] - cx, height, bounds.max[1] - cy], name };
}

export function makeBoardBack(boxes: Box[], thickness: number, boardArea: number): BoardBack {
  // Require at least 12 independent physical parts and 1% footprint coverage.
  const area = boxes.reduce((sum, box) => sum + (box.max[0] - box.min[0]) * (box.max[2] - box.min[2]), 0);
  return { boxes, thickness, enabled: boxes.length >= 12 && area >= boardArea * .01 };
}

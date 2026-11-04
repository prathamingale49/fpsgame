import type { Box, BoardBack } from '../shared/game.js';
import { isCollidableComponent } from './collision-rules.js';

export type Bounds = { min: [number, number, number]; max: [number, number, number] };
export type CollisionMesh = { attributes: { position: { array: ArrayLike<number> } }; index: { array: ArrayLike<number> } };

// Offline only: clip each triangle at the substrate bottom, then weld its
// surviving vertices to find disconnected protrusions. This also handles a
// single CAD solid whose posts are joined only by a housing ABOVE the board.
export function protrusionBoxes(meshes: CollisionMesh[], board: Bounds, name?: string): Box[] {
  const plane = board.min[2];
  const points: number[][] = [], parents: number[] = [], welded = new Map<string, number>();
  const root = (id: number): number => { while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; } return id; };
  const vertex = (p: number[]): number => {
    const key = p.map(v => Math.round(v / 1e-5)).join(',');
    let id = welded.get(key);
    if (id === undefined) { id = points.length; points.push(p); parents.push(id); welded.set(key, id); }
    return id;
  };
  for (const mesh of meshes) {
    const positions = mesh.attributes.position.array, indices = mesh.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [0, 1, 2].map(k => { const offset = indices[i + k] * 3; return [positions[offset], positions[offset + 1], positions[offset + 2]]; });
      // A housing face exactly on the boundary must not reconnect posts
      // through a zero-thickness sheet at the PCB surface.
      if (!triangle.some(p => p[2] < plane - 1e-7)) continue;
      const clipped: number[][] = [];
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        if (a[2] <= plane) clipped.push(a);
        if ((a[2] < plane && b[2] > plane) || (a[2] > plane && b[2] < plane)) {
          const t = (plane - a[2]) / (b[2] - a[2]);
          clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), plane]);
        }
      }
      if (clipped.length < 3) continue;
      const ids = clipped.map(vertex);
      for (const id of ids.slice(1)) parents[root(id)] = root(ids[0]);
    }
  }
  const regions = new Map<number, Bounds>();
  for (let id = 0; id < points.length; id++) {
    const key = root(id), p = points[id];
    let b = regions.get(key);
    if (!b) { b = { min: [...p] as Bounds['min'], max: [...p] as Bounds['max'] }; regions.set(key, b); }
    for (let axis = 0; axis < 3; axis++) { b.min[axis] = Math.min(b.min[axis], p[axis]); b.max[axis] = Math.max(b.max[axis], p[axis]); }
  }
  return [...regions.values()].map(b => bottomBox(b, board, name)).filter((b): b is Box => !!b);
}

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

import { expect, it } from 'vitest';
import * as THREE from 'three';
import { protrusionBoxes, type Bounds, type CollisionMesh } from '../tools/board-surfaces.js';
import { initialMotion, PLAYER, stepMotion, testMap, type MapData } from '../shared/game.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const board: Bounds = { min: [-10, -10, -2], max: [10, 10, 0] };
function cube(x: number, y: number, z: number, w: number, d: number, h: number): CollisionMesh {
  const g = new THREE.BoxGeometry(w, d, h); g.translate(x, y, z);
  return { attributes: { position: { array: g.attributes.position.array } }, index: { array: g.index!.array } };
}
function merge(meshes: CollisionMesh[]): CollisionMesh {
  const positions: number[] = [], indices: number[] = [];
  for (const mesh of meshes) {
    const offset = positions.length / 3;
    indices.push(...Array.from(mesh.index.array, id => id + offset));
    positions.push(...Array.from(mesh.attributes.position.array));
  }
  return { attributes: { position: { array: positions } }, index: { array: indices } };
}
const posts = [cube(-2, 0, -2.5, 1, 1, 3), cube(2, 0, -2.5, 1, 1, 3)];
const housing = cube(0, 0, 1, 12, 4, 4); // bottom at -1: entirely above substrate bottom
const boxes = protrusionBoxes([merge([...posts, housing])], board, 'J1');
function walk(x: number, side: 'front' | 'back') {
  const map: MapData = { ...testMap, width: 20, depth: 20,
    boxes: [{ min: [-6, 0, -2], max: [6, 3, 2], name: 'J1' }],
    back: { enabled: true, thickness: 2, boxes } };
  let p = { ...initialMotion([x, 0, 3]), side };
  for (let seq = 1; seq <= 60; seq++) p = stepMotion(p, { seq, forward: 1, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false }, map) as typeof p;
  return p;
}
it('separates posts within one mesh and excludes the above-board housing footprint', () => {
  expect(boxes).toHaveLength(2);
  expect(boxes.map(b => b.max[0] - b.min[0])).toEqual([1, 1]);
  expect(boxes.every(b => b.min[1] === 0 && b.max[1] === 2)).toBe(true);
  expect(boxes.every(b => b.name === 'J1')).toBe(true);
});
it('also handles independent STEP meshes without merging the gap', () => {
  expect(protrusionBoxes([...posts, housing], board)).toHaveLength(2);
});
it('lets the default 0.90 mm player cross the gap but not an actual post', () => {
  expect(PLAYER.height).toBe(.9);
  expect(walk(0, 'back').z).toBeLessThan(-3);
  expect(walk(2, 'back').z).toBeGreaterThan(.5);
});
it('keeps the full front connector collision solid', () => {
  expect(walk(0, 'front').z).toBeGreaterThan(2);
});
it('does not join posts via a housing face exactly on the clipping plane', () => {
  const touchingHousing = cube(0, 0, 0, 12, 4, 4); // bottom at -2
  expect(protrusionBoxes([merge([...posts, touchingHousing])], board)).toHaveLength(2);
});
it('welds triangle seams and keeps large posts solid', () => {
  const large = protrusionBoxes([cube(0, 0, -2, 4, 4, 6)], board);
  expect(large).toHaveLength(1);
  expect(large[0]).toMatchObject({ min: [-2, 0, -2], max: [2, 3, 2] });
});
it('clips sloping geometry at the plane instead of retaining above-plane extents', () => {
  const g = new THREE.CylinderGeometry(5, 1, 4, 8); g.rotateX(Math.PI / 2);
  g.translate(0, 0, -2); // radius 5 above board; radius 3 at clipping plane
  const clipped = protrusionBoxes([{ attributes: { position: { array: g.attributes.position.array } }, index: { array: g.index!.array } }], board);
  expect(clipped).toHaveLength(1);
  expect(clipped[0].min[0]).toBeCloseTo(-3);
  expect(clipped[0].max[0]).toBeCloseTo(3);
  expect(clipped[0].max[1]).toBeCloseTo(2);
});
it('rejects geometry only touching the boundary without protruding', () => {
  const g = new THREE.CylinderGeometry(5, 1, 4, 8); g.rotateX(Math.PI / 2);
  // Only the zero-thickness boundary touches the substrate: no protrusion.
  expect(protrusionBoxes([{ attributes: { position: { array: g.attributes.position.array } }, index: { array: g.index!.array } }], board)).toEqual([]);
});
it.skipIf(!fs.existsSync('assets/public/maps/bms.json'))('preserves all BMS front and bottom-mounted component collision boxes', () => {
  const map = JSON.parse(fs.readFileSync('assets/public/maps/bms.json', 'utf8')) as MapData;
  const bottom = new Set(map.components!.filter(c => c.layer === 'BottomLayer').map(c => c.ref));
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Snapshots from the original two-sided import: deliberate source-geometry
  // changes require refreshing these, but a protrusion-only fix must not.
  expect(hash(map.boxes)).toBe('2c81c930c68ad218bb1699d5a4e4192864d80f6010407b108dfa1a6cd131b7ff');
  expect(hash(map.back!.boxes.filter(b => bottom.has(b.name!)))).toBe('48836c20946b917719941323ccc8d0733b41c3d0fc5ea75f18717db75eb2293e');
});

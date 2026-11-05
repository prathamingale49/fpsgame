import fs from 'node:fs';
import { PNG } from 'pngjs';
import { onBoard, type MapData } from '../shared/game.js';
import { PRACTICE_MAPS } from '../shared/maps.js';
import { recolorTop } from './recolor-top.js';

// Run after import-step. Extract the actual triangulated substrate from its
// merged material group, so artwork and floor collision share the CAD outline.
const [id, top, bottom] = process.argv.slice(2);
if (!id || !top || !bottom) throw new Error('Usage: prepare-practice-map <id> <top.png> <bottom.png>');
const root = `assets/public/maps/${id}`;
const map: MapData = JSON.parse(fs.readFileSync(`${root}.json`, 'utf8'));
const glb = fs.readFileSync(`${root}.glb`);
const jsonLength = glb.readUInt32LE(12);
const doc = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const binary = glb.subarray(28 + jsonLength);
const primitive = doc.meshes[0].primitives[0];
function accessor(index: number): number[] {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  const count = a.type === 'VEC3' ? 3 : 1;
  const values: number[] = [];
  for (let i = 0; i < a.count; i++) for (let j = 0; j < count; j++) {
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? size * count) + j * size;
    values.push(a.componentType === 5126 ? binary.readFloatLE(offset) : size === 4 ? binary.readUInt32LE(offset) : binary.readUInt16LE(offset));
  }
  return values;
}
const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
map.surface = [];
for (let i = 0; i < indices.length; i += 3) {
  const vertices = indices.slice(i, i + 3).map(v => positions.slice(v * 3, v * 3 + 3));
  if (vertices.every(v => Math.abs(v[1]) < .001)) map.surface.push(...vertices.flatMap(v => [v[0], v[2]]));
}
if (!map.surface.length) throw new Error('No substrate surface triangles');
// Artwork exports have a gray viewport margin. Crop to the dark substrate
// extent (excluding yellow mechanical circles outside Flight SAM's corners).
function artwork(source: string, output: string) {
  const png = PNG.sync.read(fs.readFileSync(source));
  let x0 = png.width, y0 = png.height, x1 = 0, y1 = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4, [r, g, b] = png.data.subarray(i, i + 3);
    if (g < 60 && ((r < 130 && b < 60) || (r < 60 && b < 130))) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const cropped = new PNG({ width: x1-x0+1, height: y1-y0+1 });
  PNG.bitblt(png, cropped, x0, y0, cropped.width, cropped.height, 0, 0);
  fs.writeFileSync(output, PNG.sync.write(cropped)); recolorTop(output, output, id === 'flight-sam' ? 'blue' : id === 'recovery' ? 'black' : 'green');
  console.log(`${output}: crop ${x0},${y0}–${x1},${y1}`);
}
artwork(top, `${root}-top.png`); artwork(bottom, `${root}-bottom.png`);
map.boardColor = id === 'flight-sam' ? '#101b78' : '#101218';
map.backTexture = `/maps/${id}-bottom.png`;
map.title = PRACTICE_MAPS.find(map => map.id === id)?.title ?? id;
map.back!.enabled = true;
// Recompute distributed spawn points with the actual floor and generous
// clearance around all colliders, on the largest connected accessible region.
const cells = new Map<string, [number, number, number]>();
for (let z = -map.depth/2+4; z < map.depth/2-4; z += 2) for (let x = -map.width/2+4; x < map.width/2-4; x += 2) {
  if (![[0,0],[-1,0],[1,0],[0,-1],[0,1]].every(([a,b]) => onBoard(map,x+a,z+b))) continue;
  if (map.boxes.some(b => x+1 > b.min[0] && x-1 < b.max[0] && z+1 > b.min[2] && z-1 < b.max[2])) continue;
  cells.set(`${x},${z}`, [x,0,z]);
}
const visited = new Set<string>(); let largest: [number,number,number][] = [];
for (const key of cells.keys()) {
  if (visited.has(key)) continue;
  const queue = [key], region: typeof largest = []; visited.add(key);
  for (let i=0; i<queue.length; i++) {
    const point = cells.get(queue[i])!; region.push(point);
    for (const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2]]) {
      const next = `${point[0]+dx},${point[2]+dz}`;
      if (cells.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  if (region.length > largest.length) largest = region;
}
map.spawns = [];
while (map.spawns.length < 8 && largest.length) {
  largest.sort((a,b) => {
    const score = (p: number[]) => map.spawns.length ? Math.min(...map.spawns.map(s => Math.hypot(s[0]-p[0],s[2]-p[2]))) : -Math.hypot(p[0],p[2]);
    return score(b)-score(a);
  });
  map.spawns.push(largest.shift()!);
}
if (map.spawns.length < 6) throw new Error('Insufficient safe spawn points');
fs.writeFileSync(`${root}.json`, JSON.stringify(map));
console.log(`${map.title}: ${map.width} × ${map.depth} mm, ${map.surface.length/6} floor triangles, ${map.boxes.length}/${map.back!.boxes.length} front/back colliders`);

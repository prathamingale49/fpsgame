import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import occtimportjs from 'occt-import-js';
import type { Box, MapData, Spawn } from '../shared/game.js';

type CadMesh = { name: string; color?: [number, number, number]; attributes: { position: { array: number[] }; normal: { array: number[] } }; index: { array: number[] } };
type CadNode = { name: string; meshes: number[]; children: CadNode[] };
type Bounds = { min: [number, number, number]; max: [number, number, number] };
const source = process.argv[2];
const csvPath = process.argv[3];
const topPath = process.argv[4];
if (!source || !fs.existsSync(source)) { console.error('Usage: npm run import:step -- <assembly.step> [pick-place.csv] [top.png]'); process.exit(1); }
const output = path.resolve('assets/public/maps'); fs.mkdirSync(output, { recursive: true });
console.log('Importing STEP; a full assembly can take several minutes and substantial RAM.');
const occt = await occtimportjs();
const cad = occt.ReadStepFile(new Uint8Array(fs.readFileSync(source)), { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: .24, angularDeflection: .4 }) as { success: boolean; meshes: CadMesh[]; root: CadNode };
if (!cad.success || !cad.meshes?.length) throw new Error('STEP conversion produced no meshes');
console.log(`Tessellated ${cad.meshes.length} solids`);

function bounds(mesh: CadMesh): Bounds {
  const values = mesh.attributes.position.array;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], values[i + a]); max[a] = Math.max(max[a], values[i + a]); }
  return { min, max };
}
function union(a: Bounds, b: Bounds): Bounds {
  return { min: a.min.map((v, i) => Math.min(v, b.min[i])) as Bounds['min'], max: a.max.map((v, i) => Math.max(v, b.max[i])) as Bounds['max'] };
}
const meshBounds = cad.meshes.map(bounds);
const boardIndex = meshBounds.map((b, i) => ({ i, area: (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]), height: b.max[2] - b.min[2] })).filter(v => v.height < 4).sort((a, b) => b.area - a.area)[0]?.i;
if (boardIndex === undefined) throw new Error('Could not identify board geometry');
const board = meshBounds[boardIndex];
const cx = (board.min[0] + board.max[0]) / 2, cy = (board.min[1] + board.max[1]) / 2, boardTop = board.max[2];
const width = board.max[0] - board.min[0], depth = board.max[1] - board.min[1];
console.log(`Board ${width.toFixed(2)} × ${depth.toFixed(2)} mm, STEP bounds ${JSON.stringify(board)}`);

const palette = [0x335c2d, 0x161b1a, 0xf0ecdf, 0x752720, 0xc6a04a, 0x666f6a, 0x2d3734];
function materialIndex(mesh: CadMesh, index: number): number {
  if (index === boardIndex) return 0;
  const [r, g, b] = mesh.color ?? [.35, .38, .35];
  if (r > .75 && g > .75 && b > .75) return 2;
  if (r > g * 1.5 && r > b * 1.5) return 3;
  if (r > .5 && g > .35 && b < .35) return 4;
  if (r < .3 && g < .3 && b < .3) return 1;
  if (Math.abs(r - g) < .12 && Math.abs(g - b) < .12) return 5;
  return 6;
}
const groups = palette.map(() => ({ vertices: 0, indices: 0, meshIds: [] as number[] }));
cad.meshes.forEach((mesh, i) => { const group = groups[materialIndex(mesh, i)]; group.vertices += mesh.attributes.position.array.length / 3; group.indices += mesh.index.array.length; group.meshIds.push(i); });
const scene = new THREE.Scene();
groups.forEach((group, category) => {
  if (!group.vertices || !group.indices) return;
  const positions = new Float32Array(group.vertices * 3), normals = new Float32Array(group.vertices * 3), indices = new Uint32Array(group.indices);
  let vo = 0, io = 0;
  for (const meshId of group.meshIds) {
    const mesh = cad.meshes[meshId], p = mesh.attributes.position.array, n = mesh.attributes.normal.array, index = mesh.index.array;
    for (let i = 0; i < p.length; i += 3) {
      positions[vo * 3] = p[i] - cx; positions[vo * 3 + 1] = p[i + 2] - boardTop; positions[vo * 3 + 2] = -(p[i + 1] - cy);
      normals[vo * 3] = n[i] ?? 0; normals[vo * 3 + 1] = n[i + 2] ?? 1; normals[vo * 3 + 2] = -(n[i + 1] ?? 0);
      vo++;
    }
    for (let i = 0; i < index.length; i++) indices[io++] = index[i] + vo - p.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: palette[category], roughness: category === 4 ? .36 : .75, metalness: category === 4 ? .7 : .1, side: THREE.DoubleSide })));
});
// GLTFExporter uses FileReader in Node even when no textures are involved.
class NodeFileReader { result: ArrayBuffer | null = null; onloadend: (() => void) | null = null; readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); } }
(globalThis as unknown as { FileReader: typeof FileReader }).FileReader = NodeFileReader as unknown as typeof FileReader;
const binary = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true }) as ArrayBuffer;
fs.writeFileSync(path.join(output, 'bms.glb'), Buffer.from(binary));
console.log(`GLB ${(binary.byteLength / 1024 / 1024).toFixed(1)} MB`);

const components: MapData['components'] = [];
if (csvPath && fs.existsSync(csvPath)) {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/); const header = lines.findIndex(line => line.includes('"Designator"'));
  for (const line of lines.slice(header + 1)) {
    const fields = [...line.matchAll(/"([^"]*)"/g)].map(m => m[1]); if (fields.length < 6) continue;
    const numeric = (s: string) => Number(s.replace(',', '.'));
    components.push({ ref: fields[0], x: numeric(fields[3]) - cx, z: -(numeric(fields[4]) - cy), rotation: numeric(fields[5]), layer: fields[2] });
  }
}
function nodeMeshes(node: CadNode): number[] { return [...(node.meshes ?? []), ...(node.children ?? []).flatMap(nodeMeshes)]; }
const boxes: Box[] = [];
const assembly = cad.root.children?.find(node => node.name === 'PCB') ?? cad.root;
const nodes = assembly.children?.length ? assembly.children : [assembly];
for (const node of nodes) {
  const ids = nodeMeshes(node).filter(id => id !== boardIndex);
  if (!ids.length) continue;
  const b = ids.map(id => meshBounds[id]).reduce(union);
  const height = b.max[2] - boardTop, w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
  if (height < .8 || w < .8 || d < .8 || b.min[2] < boardTop - .6) continue;
  boxes.push({ min: [b.min[0] - cx, 0, -(b.max[1] - cy)], max: [b.max[0] - cx, height, -(b.min[1] - cy)], name: node.name });
}
const spawns: Spawn[] = [];
const grid = new Map<string, Spawn>();
const key = (x: number, z: number) => `${x},${z}`;
const gridWidth = Math.floor((width - 10) / 2), gridDepth = Math.floor((depth - 10) / 2);
for (let iz = 0; iz <= gridDepth; iz++) for (let ix = 0; ix <= gridWidth; ix++) {
  const x = -width / 2 + 5 + ix * 2, z = -depth / 2 + 5 + iz * 2;
  if (boxes.some(b => x + 1.2 > b.min[0] && x - 1.2 < b.max[0] && z + 1.2 > b.min[2] && z - 1.2 < b.max[2])) continue;
  grid.set(key(ix, iz), [x, 0, z]);
}
const visited = new Set<string>(); let largest: string[] = [];
for (const cell of grid.keys()) {
  if (visited.has(cell)) continue;
  const queue = [cell], region: string[] = []; visited.add(cell);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i], [x, z] = current.split(',').map(Number); region.push(current);
    for (const neighbor of [key(x + 1, z), key(x - 1, z), key(x, z + 1), key(x, z - 1)]) if (grid.has(neighbor) && !visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
  }
  if (region.length > largest.length) largest = region;
}
const candidates = largest.map(cell => grid.get(cell)!);
for (let i = 0; i < 8 && candidates.length; i++) {
  candidates.sort((a, b) => (spawns.length ? Math.min(...spawns.map(s => Math.hypot(b[0] - s[0], b[2] - s[2]))) - Math.min(...spawns.map(s => Math.hypot(a[0] - s[0], a[2] - s[2]))) : Math.hypot(b[0], b[2]) - Math.hypot(a[0], a[2])));
  spawns.push(candidates.shift()!);
}
if (spawns.length < 2) throw new Error('Could not find valid spawn areas');
const map: MapData = { id: 'bms', title: 'YJSP Battery Management System · Rev 4', width, depth, ground: 0, boxes, spawns, components, model: '/maps/bms.glb', texture: topPath ? '/maps/bms-top.png' : undefined };
fs.writeFileSync(path.join(output, 'bms.json'), JSON.stringify(map));
if (topPath && fs.existsSync(topPath)) fs.copyFileSync(topPath, path.join(output, 'bms-top.png'));
console.log(`Map ready: ${boxes.length} collision boxes, ${spawns.length} spawn points, ${components.length} CSV placements`);

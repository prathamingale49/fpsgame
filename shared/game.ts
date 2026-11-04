export const TICK = 1 / 60;
export const MOVEMENT_PROTOCOL = 3;
export const MATCH_SECONDS = 300;
export const RESPAWN_SECONDS = 2.5;
export const PLAYER = { radius: .36, height: 1.8, eye: 1.54, walkSpeed: 14, sprintSpeed: 20, jumpSpeed: 13.5, gravity: 30, mantleSpeed: 32, mantleReach: 7, fallDeathDepth: 18 } as const;
export type PlayerTuning = { radius: number; height: number; eye: number; walkSpeed: number; sprintSpeed: number; jumpSpeed: number; gravity: number; mantleSpeed: number; mantleReach: number; fallDeathDepth: number };
export const DEV_SCALE = { min: .75, max: 2.25, step: .05 } as const;
// Jump apex in the fixed-step integrator, accounting for velocity being decremented before movement.
// The original 1.8 mm jump is preserved and every size reaches the same fraction of its own height.
export const JUMP_HEIGHT_RATIO = (PLAYER.jumpSpeed - PLAYER.gravity * TICK / 2) ** 2 / (2 * PLAYER.gravity * PLAYER.height);
export function validDevHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < DEV_SCALE.min || value > DEV_SCALE.max) return null;
  return Number((Math.round(value / DEV_SCALE.step) * DEV_SCALE.step).toFixed(2));
}
export function tuningForHeight(height: number): PlayerTuning {
  const scale = height / PLAYER.height;
  return {
    radius: PLAYER.radius * scale, height, eye: PLAYER.eye * scale,
    walkSpeed: PLAYER.walkSpeed * scale, sprintSpeed: PLAYER.sprintSpeed * scale,
    jumpSpeed: Math.sqrt(2 * PLAYER.gravity * JUMP_HEIGHT_RATIO * height) + PLAYER.gravity * TICK / 2, gravity: PLAYER.gravity,
    mantleSpeed: PLAYER.mantleSpeed * scale, mantleReach: PLAYER.mantleReach * scale, fallDeathDepth: PLAYER.fallDeathDepth,
  };
}
export const PLAYER_RADIUS = PLAYER.radius;
export const PLAYER_HEIGHT = PLAYER.height;
export const EYE_HEIGHT = PLAYER.eye;
export const WEAPON = { name: 'Solder Blaster', damage: 25, magazine: 30, reserve: 60, maxReserve: 120, pickupRounds: 30, pickupRespawnSeconds: 20, fireInterval: 0.1, reloadSeconds: 1.7, range: 130 } as const;

export type Box = { min: [number, number, number]; max: [number, number, number]; name?: string; climbable?: boolean; kind?: 'header' | 'connector' };
export type Spawn = [number, number, number];
export type MapData = { id: string; title: string; width: number; depth: number; ground: number; boxes: Box[]; spawns: Spawn[]; model?: string; texture?: string; components?: { ref: string; x: number; z: number; rotation: number; layer: string }[] };
export type Input = { seq: number; forward: number; strafe: number; yaw: number; pitch: number; jump: boolean; sprint: boolean };
export type Motion = { x: number; y: number; z: number; vy: number; grounded: boolean; jumpHeld: boolean; mantleTarget: number };

export const testMap: MapData = {
  id: 'test', title: 'Prototype Circuit', width: 100, depth: 72, ground: 0,
  boxes: [
    { min: [-27, 0, -24], max: [-21, 8, -18], name: 'C1', climbable: true }, { min: [-27, 0, 18], max: [-21, 8, 24], name: 'C2', climbable: true },
    { min: [17, 0, -6], max: [28, 4, 6], name: 'U1' }, { min: [-5, 0, -27], max: [4, 5, -18], name: 'L1' },
    { min: [-5, 0, 18], max: [4, 5, 27], name: 'L2' }, { min: [-9, 0, -5], max: [-1, 3, 5], name: 'Q1' },
  ],
  spawns: [[-38, 0, -25], [37, 0, 25], [-37, 0, 25], [37, 0, -25], [4, 0, 0], [15, 0, 20], [-15, 0, -10], [22, 0, -23]],
};

export function clamp(value: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, value)); }
export function initialMotion(spawn: Spawn): Motion { return { x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, grounded: true, jumpHeld: false, mantleTarget: 0 }; }
export function validInput(v: unknown): v is Input {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return Number.isInteger(a.seq) && Number(a.seq) >= 0 && Number.isFinite(a.forward) && Number.isFinite(a.strafe)
    && Number.isFinite(a.yaw) && Number.isFinite(a.pitch) && Math.abs(Number(a.forward)) <= 1
    && Math.abs(Number(a.strafe)) <= 1 && Math.abs(Number(a.pitch)) <= 1.5
    && typeof a.jump === 'boolean' && typeof a.sprint === 'boolean';
}

const CELL = 5;
const MAX_QUERY_CACHE = 256;
type Index = Map<string, Box[]>;
const indices = new WeakMap<MapData, { cells: Index; queries: Index }>();
export function collisionCacheStats(map: MapData): { cells: number; queries: number } {
  const index = indices.get(map);
  return { cells: index?.cells.size ?? 0, queries: index?.queries.size ?? 0 };
}
function nearby(map: MapData, x0: number, z0: number, x1: number, z1: number): Box[] {
  let index = indices.get(map);
  if (!index) {
    index = { cells: new Map(), queries: new Map() };
    for (const box of map.boxes) for (let x = Math.floor(box.min[0] / CELL); x <= Math.floor(box.max[0] / CELL); x++) for (let z = Math.floor(box.min[2] / CELL); z <= Math.floor(box.max[2] / CELL); z++) {
      const key = `${x},${z}`, cell = index.cells.get(key) ?? [];
      cell.push(box); index.cells.set(key, cell);
    }
    indices.set(map, index);
  }
  const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
  if (cx0 === cx1 && cz0 === cz1) return index.cells.get(`${cx0},${cz0}`) ?? [];
  const queryKey = `${cx0},${cz0}:${cx1},${cz1}`;
  const cached = index.queries.get(queryKey); if (cached) return cached;
  const result = new Set<Box>();
  for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) for (const box of index.cells.get(`${x},${z}`) ?? []) result.add(box);
  const boxes = [...result];
  if (index.queries.size >= MAX_QUERY_CACHE) index.queries.delete(index.queries.keys().next().value!);
  index.queries.set(queryKey, boxes); return boxes;
}
export type MotionStats = { collisionChecks: number };
function touches(x: number, z: number, box: Box, radius: number): boolean {
  const dx = Math.max(box.min[0] - x, 0, x - box.max[0]);
  const dz = Math.max(box.min[2] - z, 0, z - box.max[2]);
  return dx * dx + dz * dz < radius * radius;
}
function overlaps(x: number, y: number, z: number, box: Box, tuning: PlayerTuning, stats?: MotionStats): boolean {
  if (stats) stats.collisionChecks++;
  return touches(x, z, box, tuning.radius) && y < box.max[1] - .01 && y + tuning.height > box.min[1] + .01;
}

export function stepMotion(previous: Motion, input: Input, map: MapData, dt = TICK, stats?: MotionStats, tuning: PlayerTuning = PLAYER): Motion {
  const out = { ...previous };
  const f = input.forward, s = input.strafe;
  const len = Math.max(1, Math.hypot(f, s));
  const speed = input.sprint ? tuning.sprintSpeed : tuning.walkSpeed;
  const dx = (-Math.sin(input.yaw) * f + Math.cos(input.yaw) * s) / len * speed * dt;
  const dz = (-Math.cos(input.yaw) * f - Math.sin(input.yaw) * s) / len * speed * dt;
  if (input.jump && !out.jumpHeld && out.grounded) { out.vy = tuning.jumpSpeed; out.grounded = false; }
  out.jumpHeld = input.jump;
  const oldY = out.y;
  const mantleTop = out.mantleTarget;
  if (out.mantleTarget > 0) {
    out.y = Math.min(out.mantleTarget, out.y + tuning.mantleSpeed * dt);
    out.vy = 0;
    out.grounded = out.y >= out.mantleTarget;
    if (out.grounded) out.mantleTarget = 0;
  } else {
    out.vy -= tuning.gravity * dt;
    out.y += out.vy * dt;
    out.grounded = false;
    const overBoard = Math.abs(out.x) <= map.width / 2 && Math.abs(out.z) <= map.depth / 2;
    if (overBoard && oldY >= map.ground - .02 && out.y <= map.ground) { out.y = map.ground; out.vy = 0; out.grounded = true; }
  }
  const candidates = nearby(map, Math.min(out.x, out.x + dx) - tuning.radius, Math.min(out.z, out.z + dz) - tuning.radius, Math.max(out.x, out.x + dx) + tuning.radius, Math.max(out.z, out.z + dz) + tuning.radius);
  if (mantleTop > 0 && out.mantleTarget === 0) {
    const ledge = candidates.find(b => b.climbable && Math.abs(b.max[1] - mantleTop) < .01
      && Math.hypot(clamp(out.x, b.min[0] + .1, b.max[0] - .1) - out.x, clamp(out.z, b.min[2] + .1, b.max[2] - .1) - out.z) < tuning.radius + .3);
    if (ledge) {
      const pulledX = clamp(out.x, ledge.min[0] + .1, ledge.max[0] - .1);
      const pulledZ = clamp(out.z, ledge.min[2] + .1, ledge.max[2] - .1);
      const pullCandidates = nearby(map, Math.min(out.x, pulledX) - tuning.radius, Math.min(out.z, pulledZ) - tuning.radius,
        Math.max(out.x, pulledX) + tuning.radius, Math.max(out.z, pulledZ) + tuning.radius);
      if (Math.hypot(pulledX - out.x, pulledZ - out.z) < tuning.radius + .3
        && !pullCandidates.some(b => b !== ledge && overlaps(pulledX, out.y, pulledZ, b, tuning, stats))) { out.x = pulledX; out.z = pulledZ; }
    }
  }
  for (const box of candidates) {
    if (stats) stats.collisionChecks++;
    if (out.vy <= 0 && oldY >= box.max[1] - 0.02 && out.y <= box.max[1]
      && touches(out.x, out.z, box, tuning.radius)) {
      out.y = box.max[1]; out.vy = 0; out.grounded = true;
    }
  }
  const tryX = out.x + dx;
  const tryZ = out.z + dz;
  if (input.jump && !out.grounded && out.mantleTarget === 0 && out.y >= map.ground + 1 && out.vy <= 2) {
    const ledge = candidates.find(b => b.climbable && b.max[1] > out.y + .2 && b.max[1] - out.y <= tuning.mantleReach
      && (touches(tryX, tryZ, b, tuning.radius) || touches(tryX, out.z, b, tuning.radius) || touches(out.x, tryZ, b, tuning.radius))
      && !candidates.some(other => other !== b && overlaps(out.x, b.max[1], out.z, other, tuning, stats)));
    if (ledge) { out.mantleTarget = ledge.max[1]; out.vy = 0; }
  }
  if (!candidates.some(b => overlaps(tryX, out.y, out.z, b, tuning, stats))) out.x = tryX;
  if (!candidates.some(b => overlaps(out.x, out.y, tryZ, b, tuning, stats))) out.z = tryZ;
  if (out.y > oldY && out.mantleTarget === 0 && candidates.some(b => overlaps(out.x, out.y, out.z, b, tuning, stats))) { out.y = oldY; out.vy = 0; }
  return out;
}

export type Ray = { origin: [number, number, number]; direction: [number, number, number] };
export function aimRay(x: number, y: number, z: number, yaw: number, pitch: number, tuning: PlayerTuning = PLAYER): Ray {
  return { origin: [x, y + tuning.eye, z], direction: [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] };
}
export function rayBox(ray: Ray, box: Box): number {
  let lo = 0, hi: number = WEAPON.range;
  for (let i = 0; i < 3; i++) {
    const d = ray.direction[i], o = ray.origin[i];
    if (Math.abs(d) < 1e-8) { if (o < box.min[i] || o > box.max[i]) return Infinity; continue; }
    let a = (box.min[i] - o) / d, b = (box.max[i] - o) / d;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  return lo;
}
export function rayPlayer(ray: Ray, player: Motion, tuning: PlayerTuning = PLAYER): number {
  const box: Box = { min: [player.x - tuning.radius, player.y, player.z - tuning.radius], max: [player.x + tuning.radius, player.y + tuning.height, player.z + tuning.radius] };
  return rayBox(ray, box);
}
export function hitscan(ray: Ray, map: MapData, players: Iterable<[string, Motion]>, shooterId: string, tuning: PlayerTuning = PLAYER): { target?: string; distance: number } {
  let distance: number = WEAPON.range, target: string | undefined;
  for (const box of map.boxes) distance = Math.min(distance, rayBox(ray, box));
  for (const [id, player] of players) {
    if (id === shooterId) continue;
    const hit = rayPlayer(ray, player, tuning);
    if (hit < distance) { distance = hit; target = id; }
  }
  return { target, distance };
}

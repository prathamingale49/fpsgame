export const TICK = 1 / 60;
export const MATCH_SECONDS = 300;
export const RESPAWN_SECONDS = 2.5;
export const PLAYER_RADIUS = 0.48;
export const PLAYER_HEIGHT = 2.4;
export const EYE_HEIGHT = 2.05;
export const WEAPON = { damage: 25, magazine: 30, reserve: 120, fireInterval: 0.1, reloadSeconds: 1.7, range: 130 } as const;

export type Box = { min: [number, number, number]; max: [number, number, number]; name?: string };
export type Spawn = [number, number, number];
export type MapData = { id: string; title: string; width: number; depth: number; ground: number; boxes: Box[]; spawns: Spawn[]; model?: string; texture?: string; components?: { ref: string; x: number; z: number; rotation: number; layer: string }[] };
export type Input = { seq: number; forward: number; strafe: number; yaw: number; pitch: number; jump: boolean; sprint: boolean };
export type Motion = { x: number; y: number; z: number; vy: number; grounded: boolean };

export const testMap: MapData = {
  id: 'test', title: 'Prototype Circuit', width: 100, depth: 72, ground: 0,
  boxes: [
    { min: [-49, 0, -36], max: [-47, 7, 36] }, { min: [47, 0, -36], max: [49, 7, 36] },
    { min: [-49, 0, -36], max: [49, 7, -34] }, { min: [-49, 0, 34], max: [49, 7, 36] },
    { min: [-27, 0, -24], max: [-21, 8, -18], name: 'C1' }, { min: [-27, 0, 18], max: [-21, 8, 24], name: 'C2' },
    { min: [17, 0, -6], max: [28, 4, 6], name: 'U1' }, { min: [-5, 0, -27], max: [4, 5, -18], name: 'L1' },
    { min: [-5, 0, 18], max: [4, 5, 27], name: 'L2' }, { min: [-9, 0, -5], max: [-1, 3, 5], name: 'Q1' },
  ],
  spawns: [[-38, 0, -25], [37, 0, 25], [-37, 0, 25], [37, 0, -25], [4, 0, 0], [15, 0, 20], [-15, 0, -10], [22, 0, -23]],
};

export function clamp(value: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, value)); }
export function initialMotion(spawn: Spawn): Motion { return { x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, grounded: true }; }
export function validInput(v: unknown): v is Input {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return Number.isInteger(a.seq) && Number(a.seq) >= 0 && Number.isFinite(a.forward) && Number.isFinite(a.strafe)
    && Number.isFinite(a.yaw) && Number.isFinite(a.pitch) && Math.abs(Number(a.forward)) <= 1
    && Math.abs(Number(a.strafe)) <= 1 && Math.abs(Number(a.pitch)) <= 1.5
    && typeof a.jump === 'boolean' && typeof a.sprint === 'boolean';
}

function overlaps(x: number, y: number, z: number, box: Box): boolean {
  return x + PLAYER_RADIUS > box.min[0] && x - PLAYER_RADIUS < box.max[0]
    && z + PLAYER_RADIUS > box.min[2] && z - PLAYER_RADIUS < box.max[2]
    && y < box.max[1] - 0.01 && y + PLAYER_HEIGHT > box.min[1] + 0.01;
}

export function stepMotion(previous: Motion, input: Input, map: MapData, dt = TICK): Motion {
  const out = { ...previous };
  const f = input.forward, s = input.strafe;
  const len = Math.max(1, Math.hypot(f, s));
  const speed = input.sprint ? 12 : 8.5;
  const dx = (-Math.sin(input.yaw) * f + Math.cos(input.yaw) * s) / len * speed * dt;
  const dz = (-Math.cos(input.yaw) * f - Math.sin(input.yaw) * s) / len * speed * dt;
  if (input.jump && out.grounded) { out.vy = 18.5; out.grounded = false; }
  out.vy -= 23 * dt;
  const oldY = out.y;
  out.y += out.vy * dt;
  out.grounded = false;
  if (out.y <= map.ground) { out.y = map.ground; out.vy = 0; out.grounded = true; }
  for (const box of map.boxes) {
    if (out.vy <= 0 && oldY >= box.max[1] - 0.02 && out.y <= box.max[1]
      && out.x + PLAYER_RADIUS > box.min[0] && out.x - PLAYER_RADIUS < box.max[0]
      && out.z + PLAYER_RADIUS > box.min[2] && out.z - PLAYER_RADIUS < box.max[2]) {
      out.y = box.max[1]; out.vy = 0; out.grounded = true;
    }
  }
  const tryX = clamp(out.x + dx, -map.width / 2 + PLAYER_RADIUS, map.width / 2 - PLAYER_RADIUS);
  if (!map.boxes.some(b => overlaps(tryX, out.y, out.z, b))) out.x = tryX;
  const tryZ = clamp(out.z + dz, -map.depth / 2 + PLAYER_RADIUS, map.depth / 2 - PLAYER_RADIUS);
  if (!map.boxes.some(b => overlaps(out.x, out.y, tryZ, b))) out.z = tryZ;
  if (out.y > oldY && map.boxes.some(b => overlaps(out.x, out.y, out.z, b))) { out.y = oldY; out.vy = 0; }
  return out;
}

export type Ray = { origin: [number, number, number]; direction: [number, number, number] };
export function aimRay(x: number, y: number, z: number, yaw: number, pitch: number): Ray {
  return { origin: [x, y + EYE_HEIGHT, z], direction: [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] };
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
export function rayPlayer(ray: Ray, player: Motion): number {
  const box: Box = { min: [player.x - PLAYER_RADIUS, player.y, player.z - PLAYER_RADIUS], max: [player.x + PLAYER_RADIUS, player.y + PLAYER_HEIGHT, player.z + PLAYER_RADIUS] };
  return rayBox(ray, box);
}
export function hitscan(ray: Ray, map: MapData, players: Iterable<[string, Motion]>, shooterId: string): { target?: string; distance: number } {
  let distance: number = WEAPON.range, target: string | undefined;
  for (const box of map.boxes) distance = Math.min(distance, rayBox(ray, box));
  for (const [id, player] of players) {
    if (id === shooterId) continue;
    const hit = rayPlayer(ray, player);
    if (hit < distance) { distance = hit; target = id; }
  }
  return { target, distance };
}

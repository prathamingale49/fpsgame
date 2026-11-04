import { Room, type Client } from 'colyseus';
import { MatchState, PlayerState, PickupState } from './state.js';
import { aimRay, hitscan, initialMotion, stepMotion, testMap, TICK, MATCH_SECONDS, RESPAWN_SECONDS, WEAPON, validInput, type Input, type MapData, type Motion } from '../shared/game.js';
const PLAYER_PICKUP_DISTANCE = .9;

type Runtime = { queue: Input[]; lastReceived: number; lastSeq: number; credit: number; lastShot: number; reloadAt: number; respawnAt: number };
export let activeMap: MapData = testMap;
export function setActiveMap(map: MapData) { activeMap = map; }
export function safeName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) || 'Engineer' : 'Engineer';
}

export class GameRoom extends Room {
  maxClients = 8;
  state = new MatchState();
  private runtime = new Map<string, Runtime>();
  private elapsed = 0;
  private endAt = 0;
  private spawnIndex = 0;
  private pickupRespawns = new Map<string, number>();
  private readonly matchSeconds = Number(process.env.PCB_TEST_MATCH_SECONDS || MATCH_SECONDS);
  private readonly pickupSeconds = Number(process.env.PCB_TEST_PICKUP_SECONDS || WEAPON.pickupRespawnSeconds);

  onCreate() {
    this.roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.state.mapId = activeMap.id;
    this.state.seconds = this.matchSeconds;
    activeMap.spawns.slice(2, 8).forEach((spawn, index) => this.state.pickups.set(String(index), new PickupState({ x: spawn[0], y: spawn[1] + .2, z: spawn[2] })));
    this.setSimulationInterval(() => this.tick(), 1000 / 60);
    this.setPatchRate(50);
    this.onMessage('input', (client, payload: unknown) => {
      if (!validInput(payload)) return;
      const r = this.runtime.get(client.sessionId);
      if (r && payload.seq > r.lastReceived && payload.seq <= r.lastReceived + 240) {
        r.lastReceived = payload.seq;
        r.queue.push(payload);
        if (r.queue.length > 120) r.queue.shift();
        const p = this.state.players.get(client.sessionId);
        if (p) { p.yaw = payload.yaw; p.pitch = payload.pitch; }
      }
    });
    this.onMessage('shoot', (client) => this.shoot(client));
    this.onMessage('reload', (client) => this.reload(client.sessionId));
  }

  onJoin(client: Client, options: { name?: string }) {
    const spawn = activeMap.spawns[this.spawnIndex++ % activeMap.spawns.length];
    const p = new PlayerState({ name: safeName(options?.name), x: spawn[0], y: spawn[1], z: spawn[2] });
    this.state.players.set(client.sessionId, p);
    this.runtime.set(client.sessionId, { queue: [], lastReceived: 0, lastSeq: 0, credit: 0, lastShot: -Infinity, reloadAt: 0, respawnAt: 0 });
    if (this.state.players.size >= 2 && this.state.phase === 'waiting') this.startMatch();
    this.broadcast('feed', { text: `${p.name} connected` });
  }

  onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    const r = this.runtime.get(client.sessionId); if (r) { r.queue.length = 0; r.credit = 0; r.lastReceived = r.lastSeq; }
    this.allowReconnection(client, 30);
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) this.broadcast('feed', { text: `${p.name} disconnected` });
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
    if (this.state.players.size < 2 && this.state.phase === 'playing') this.state.phase = 'waiting';
  }

  private startMatch() {
    this.elapsed = 0; this.state.seconds = this.matchSeconds; this.state.winner = ''; this.state.phase = 'playing';
    this.state.players.forEach((p) => { p.kills = 0; p.deaths = 0; p.hp = 100; p.alive = true; p.ammo = WEAPON.magazine; p.reserve = WEAPON.reserve; p.reloading = false; });
    this.runtime.forEach((r, id) => { r.queue.length = 0; r.credit = 0; r.lastSeq = r.lastReceived; r.lastShot = -Infinity; r.reloadAt = 0; const p = this.state.players.get(id); if (p) p.ack = r.lastSeq; });
    this.state.pickups.forEach((pickup) => { pickup.active = true; }); this.pickupRespawns.clear();
    this.broadcast('feed', { text: 'Match started' });
  }

  private tick() {
    const now = Date.now() / 1000;
    this.state.pickups.forEach((pickup, id) => { if (!pickup.active && now >= (this.pickupRespawns.get(id) ?? Infinity)) { pickup.active = true; this.pickupRespawns.delete(id); } });
    if (this.state.phase === 'playing') {
      this.elapsed += TICK;
      this.state.seconds = Math.max(0, Math.ceil(this.matchSeconds - this.elapsed));
      if (this.elapsed >= this.matchSeconds) {
        const scores = [...this.state.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        this.state.winner = scores[0]?.name ?? '';
        this.state.phase = 'ended'; this.endAt = now + 8;
        this.broadcast('feed', { text: `${this.state.winner || 'Nobody'} wins!` });
      }
    } else if (this.state.phase === 'ended' && now >= this.endAt) {
      if (this.state.players.size >= 2) this.startMatch(); else this.state.phase = 'waiting';
    }
    this.state.players.forEach((p, id) => {
      const r = this.runtime.get(id); if (!r) return;
      if (!p.alive) { if (now >= r.respawnAt && this.state.phase !== 'ended') this.respawn(id); return; }
      if (p.reloading && now >= r.reloadAt) {
        const count = Math.min(WEAPON.magazine - p.ammo, p.reserve);
        p.ammo += count; p.reserve -= count; p.reloading = false;
      }
      if (!p.connected) return;
      r.credit = Math.min(6, r.credit + 1);
      let processed = 0;
      while (r.credit >= 1 && r.queue.length && processed < 6) {
        const input = r.queue.shift()!;
        const motion = stepMotion({ x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded }, input, activeMap);
        p.x = motion.x; p.y = motion.y; p.z = motion.z; p.vy = motion.vy; p.grounded = motion.grounded;
        p.yaw = input.yaw; p.pitch = input.pitch;
        r.lastSeq = input.seq; p.ack = input.seq; r.credit--; processed++;
      }
      if (p.reserve < WEAPON.maxReserve) this.state.pickups.forEach((pickup, pickupId) => {
        if (!pickup.active || Math.hypot(p.x - pickup.x, p.z - pickup.z) > PLAYER_PICKUP_DISTANCE || Math.abs(p.y - pickup.y) > 1.5) return;
        p.reserve = Math.min(WEAPON.maxReserve, p.reserve + WEAPON.pickupRounds);
        pickup.active = false; this.pickupRespawns.set(pickupId, now + this.pickupSeconds);
        this.broadcast('pickup', { player: id, amount: WEAPON.pickupRounds });
      });
    });
  }

  private reload(id: string) {
    const p = this.state.players.get(id), r = this.runtime.get(id);
    if (!p || !r || !p.alive || p.reloading || p.ammo === WEAPON.magazine || p.reserve === 0) return;
    p.reloading = true; r.reloadAt = Date.now() / 1000 + WEAPON.reloadSeconds;
  }

  private shoot(client: Client) {
    const id = client.sessionId, p = this.state.players.get(id), r = this.runtime.get(id);
    const now = Date.now() / 1000;
    if (!p || !r || !p.alive || !p.connected || this.state.phase !== 'playing' || p.reloading || now - r.lastShot < WEAPON.fireInterval) return;
    if (p.ammo <= 0) { this.reload(id); return; }
    r.lastShot = now; p.ammo--;
    const ray = aimRay(p.x, p.y, p.z, p.yaw, p.pitch);
    const opponents = [...this.state.players.entries()].filter(([otherId, other]) => otherId !== id && other.alive && other.connected).map(([otherId, other]) => [otherId, other as Motion] as [string, Motion]);
    const result = hitscan(ray, activeMap, opponents, id);
    const end = ray.origin.map((v, i) => v + ray.direction[i] * result.distance);
    this.broadcast('shot', { shooter: id, from: ray.origin, to: end, hit: result.target });
    if (p.ammo === 0 && p.reserve > 0) this.reload(id);
    if (!result.target) return;
    const target = this.state.players.get(result.target); if (!target) return;
    target.hp = Math.max(0, target.hp - WEAPON.damage);
    this.broadcast('damage', { target: result.target, shooter: id, amount: WEAPON.damage });
    if (target.hp === 0) {
      target.alive = false; target.deaths++; p.kills++;
      const targetRuntime = this.runtime.get(result.target); if (targetRuntime) targetRuntime.respawnAt = now + RESPAWN_SECONDS;
      this.broadcast('feed', { text: `${p.name} eliminated ${target.name}` });
    }
  }

  private respawn(id: string) {
    const p = this.state.players.get(id); if (!p) return;
    const spawn = activeMap.spawns[this.spawnIndex++ % activeMap.spawns.length];
    const m = initialMotion(spawn);
    p.x = m.x; p.y = m.y; p.z = m.z; p.vy = 0; p.grounded = true;
    p.hp = 100; p.alive = true; p.ammo = WEAPON.magazine; p.reserve = WEAPON.reserve; p.reloading = false;
    const r = this.runtime.get(id); if (r) { r.queue.length = 0; r.credit = 0; r.lastSeq = r.lastReceived; p.ack = r.lastSeq; }
    this.broadcast('feed', { text: `${p.name} respawned` });
  }
}

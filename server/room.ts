import { KillChain } from './kill-chain.js';
import { Room, type Client } from 'colyseus';
import { MatchState, PlayerState, PickupState, WeaponPickupState } from './state.js';
import { WEAPONS, validWeaponId, ironDamage, sniperAim, pumpRays, weaponHits, weaponKillMessage, HEAT, type WeaponId } from '../shared/weapons.js';
import { weaponPickupLocations, droppedWeaponPosition, canCollectWeapon, WEAPON_PICKUPS } from '../shared/weapon-pickups.js';
import { aimRay, movementYaw, collisionCacheStats, hitscan, initialMotion, samplePosition, stepMotion, testMap, TICK, MOVEMENT_PROTOCOL, MATCH_SECONDS, RESPAWN_SECONDS, PLAYER, WEAPON, COMBAT, tuningForHeight, validDevHeight, validInput, validShotInput, type Input, type ShotInput, type PositionSample, type MapData, type Motion, type PlayerTuning, type BoardSide } from '../shared/game.js';
const PLAYER_PICKUP_DISTANCE = .9;
const TRACE_MOVEMENT = process.env.PCB_MOVEMENT_TRACE === '1';
export const DEV_SCALE_ENABLED = process.env.PCB_DEV_SCALE === '1' && process.env.NODE_ENV !== 'production';

type Runtime = { queue: Map<number, Input>; lastReceived: number; lastSeq: number; credit: number; lastShot: number; lastShotId: number; reloadAt: number; respawnAt: number };
export let activeMap: MapData = testMap;
export function setActiveMap(map: MapData) { activeMap = map; }
export const serverPerf = { ticks: 0, tickMsTotal: 0, tickMsMax: 0, queueMax: 0, queueTotal: 0, processed: 0, cache: () => collisionCacheStats(activeMap) };
export function safeName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) || 'Engineer' : 'Engineer';
}

export class GameRoom extends Room {
  private weapons = new Map<string, { held: boolean; lease: number; shot?: ShotInput; pulse: number; heatAt: number; stocks: Map<WeaponId, { ammo: number; reserve: number }> }>();
  private weaponControl(id: string) {
    let control = this.weapons.get(id);
    if (!control) { control = { held: false, lease: 0, pulse: 0, heatAt: Date.now() / 1000, stocks: new Map() }; this.weapons.set(id, control); }
    return control;
  }
  private cancelWeapon(id: string) { const p = this.state.players.get(id); if (p) { p.chargeStarted = 0; p.triggerHeld = false; } const c = this.weapons.get(id); if (c) { c.held = false; c.shot = undefined; } }
  practice: boolean = false;
  private weaponRespawns = new Map<string, number>();
  private drops = new Map<string, { owner: string; unlockAt: number; expiresAt: number; ammo: number; reserve: number; reloadAt: number; heat: number; overheated: boolean; readyAt: number }>();
  private nextDrop = 0;
  private dropSpecial(id: string): boolean {
    const p = this.state.players.get(id), r = this.runtime.get(id);
    if (this.practice || !p || !r || !validWeaponId(p.specialWeapon) || p.specialWeapon === 'solder') return true;
    const point = droppedWeaponPosition(p, activeMap); if (!point) return false;
    const weapon = p.specialWeapon, c = this.weaponControl(id), config = WEAPONS[weapon];
    const stock = p.weapon === weapon ? { ammo: p.ammo, reserve: p.reserve } : c.stocks.get(weapon) ?? { ammo: config.magazine, reserve: config.reserve };
    const reloadAt = weapon === 'sniper' ? p.sniperReloadAt : p.weapon === weapon && p.reloading ? r.reloadAt : 0;
    const now = Date.now() / 1000, dropId = `drop-${++this.nextDrop}`;
    this.drops.set(dropId, { owner: id, unlockAt: now + .75, expiresAt: now + Number(process.env.PCB_TEST_DROP_SECONDS || 30), ...stock, reloadAt, heat: p.heat, overheated: p.overheated, readyAt: p.weaponReadyAt });
    this.state.weaponPickups.set(dropId, new WeaponPickupState({ ...point, weapon, dropped: true }));
    if (p.weapon !== 'solder') this.equipWeapon(id, 'solder');
    c.stocks.delete(weapon); p.specialWeapon = ''; p.sniperReloadAt = 0;
    return true;
  }
  private bots = new Map<string, { mode: number; next: number; yaw: number; moving: boolean; sprint: boolean }>();
  maxClients = 8;
  state = new MatchState();
  private killChain = new KillChain();
  private runtime = new Map<string, Runtime>();
  private hitHistory = new Map<string, PositionSample[]>();
  private elapsed = 0;
  private endAt = 0;
  private spawnIndex = 0;
  private lastTickAt = performance.now();
  private pickupRespawns = new Map<string, number>();
  private readonly matchSeconds = Number(process.env.PCB_TEST_MATCH_SECONDS || MATCH_SECONDS);
  private readonly pickupSeconds = Number(process.env.PCB_TEST_PICKUP_SECONDS || WEAPON.pickupRespawnSeconds);
  private playerTuning: PlayerTuning = PLAYER;

  onCreate() {
    this.state.practice = this.practice;

    if (!this.practice) weaponPickupLocations(activeMap, Math.floor(Math.random() * 0xffffffff)).forEach((point, index) => this.state.weaponPickups.set(String(index), new WeaponPickupState({ ...point, weapon: index >= 9 ? 'sniper' : (['iron', 'air', 'pump'] as const)[index % 3] })));
    if (this.practice) { this.maxClients = 1; void this.setPrivate(true); }
    this.onMessage('practice:movement', () => { if (this.practice) this.state.npcMovement = !this.state.npcMovement; });
    this.roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.state.mapId = activeMap.id;
    this.state.playerHeight = this.playerTuning.height;
    this.state.seconds = this.matchSeconds;
    activeMap.spawns.slice(2, 8).forEach((spawn, index) => this.state.pickups.set(String(index), new PickupState({ x: spawn[0], y: spawn[1] + .2, z: spawn[2] })));
    if (activeMap.back?.enabled) activeMap.spawns.slice(2, 8).forEach((spawn, index) => {
      const x = spawn[0], z = -spawn[2];
      const y = Math.max(activeMap.ground, ...activeMap.back!.boxes.filter(b => x + .5 > b.min[0] && x - .5 < b.max[0] && z + .5 > b.min[2] && z - .5 < b.max[2]).map(b => b.max[1]));
      this.state.pickups.set(`back-${index}`, new PickupState({ x, y: y + .2, z, side: 'back' }));
    });
    this.setSimulationInterval(() => this.tick(), 1000 / 60);
    this.setPatchRate(50);
    this.onMessage('input', (client, payload: unknown) => {
      if (!validInput(payload)) return;
      const r = this.runtime.get(client.sessionId);
      if (r && payload.seq > r.lastSeq && payload.seq <= r.lastSeq + 2048 && !r.queue.has(payload.seq) && r.queue.size < 2048) {
        const newest = payload.seq >= r.lastReceived;
        r.lastReceived = Math.max(r.lastReceived, payload.seq);
        r.queue.set(payload.seq, payload);
        if (TRACE_MOVEMENT) console.log('MOVE_TRACE', JSON.stringify({ event: 'receive', player: client.sessionId, seq: payload.seq, ack: r.lastSeq, queue: r.queue.size }));
        const p = this.state.players.get(client.sessionId);
        if (p && newest) { p.yaw = payload.yaw; p.pitch = payload.pitch; }
      } else if (TRACE_MOVEMENT) console.log('MOVE_TRACE', JSON.stringify({ event: 'reject', player: client.sessionId, seq: payload.seq, lastReceived: r?.lastReceived, ack: r?.lastSeq }));
    });
    this.onMessage('shoot', (client, payload: unknown) => this.shoot(client, payload));
    this.onMessage('weapon:select', (client, value: unknown) => {
      const p = this.state.players.get(client.sessionId), r = this.runtime.get(client.sessionId);
      if (!this.practice || !p?.alive || p.npc || !r || !validWeaponId(value) || value === p.weapon) return;
      this.equipWeapon(client.sessionId, value);
    });
    this.onMessage('weapon:swap', client => {
      const p = this.state.players.get(client.sessionId);
      if (!this.practice && p?.alive && p.specialWeapon) this.equipWeapon(client.sessionId, (p.weapon === 'solder' ? p.specialWeapon : 'solder') as WeaponId);
    });
    this.onMessage('weapon:collect', (client, value: unknown) => {
      if (this.practice || !value || typeof value !== 'object') return;
      const request = value as { id?: unknown; version?: unknown }, p = this.state.players.get(client.sessionId);
      if (typeof request.id !== 'string' || !Number.isSafeInteger(request.version) || !p || p.npc || p.transitionCooldown > 0) return;
      const pickup = this.state.weaponPickups.get(request.id);
      if (!pickup || pickup.version !== request.version || !canCollectWeapon(p, pickup, activeMap) || p.specialWeapon === pickup.weapon) return;
      const now = Date.now() / 1000, drop = this.drops.get(request.id);
      if (pickup.dropped && (!drop || now >= drop.expiresAt || drop.owner === client.sessionId && now < drop.unlockAt)) return;
      if (!this.dropSpecial(client.sessionId)) return;
      p.sniperReloadAt = 0;
      if (p.weapon !== 'solder') this.equipWeapon(client.sessionId, 'solder');
      p.specialWeapon = pickup.weapon;
      if (drop) this.weaponControl(client.sessionId).stocks.set(pickup.weapon as WeaponId, { ammo: drop.ammo, reserve: drop.reserve });
      this.equipWeapon(client.sessionId, pickup.weapon as WeaponId);
      if (drop) {
        p.heat = drop.heat; p.overheated = drop.overheated; p.weaponReadyAt = Math.max(p.weaponReadyAt, drop.readyAt);
        if (drop.reloadAt > now) { p.reloading = true; this.runtime.get(client.sessionId)!.reloadAt = drop.reloadAt; if (p.weapon === 'sniper') p.sniperReloadAt = drop.reloadAt; }
        else if (drop.reloadAt > 0) {
          const count = Math.min(WEAPONS[p.weapon as WeaponId].magazine - p.ammo, p.reserve);
          p.ammo += count; p.reserve -= count; if (p.weapon === 'sniper') p.reserve = 1;
        }
      }
      pickup.active = false; pickup.version++;
      if (pickup.dropped) { this.state.weaponPickups.delete(request.id); this.drops.delete(request.id); }
      else this.weaponRespawns.set(request.id, now + Number(process.env.PCB_TEST_WEAPON_PICKUP_SECONDS || WEAPON_PICKUPS.respawnSeconds));
      this.broadcast('feed', { text: `${p.name} collected ${WEAPONS[pickup.weapon as WeaponId].name}` });
    });
    this.onMessage('weapon:trigger', (client, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const action = (value as { action?: unknown }).action, shot = (value as { shot?: unknown }).shot;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.npc) return;
      if (action === 'cancel') { this.cancelWeapon(client.sessionId); return; }
      if (!validShotInput(shot)) return;
      const c = this.weaponControl(client.sessionId), now = Date.now() / 1000;
      if (!p.alive || !p.connected || p.reloading || p.transitionCooldown > 0) { this.cancelWeapon(client.sessionId); return; }
      if (action === 'start' && !c.held && now >= p.weaponReadyAt && (p.weapon === 'iron' || p.weapon === 'air')) {
        c.held = true; p.triggerHeld = true; c.lease = now; c.shot = shot;
        if (p.weapon === 'iron') p.chargeStarted = now;
      } else if (action === 'aim' && c.held) { c.lease = now; c.shot = shot; }
      else if (action === 'release') {
        if (!c.held || p.chargeStarted <= 0 || now - c.lease > HEAT.lease) { this.cancelWeapon(client.sessionId); return; }
        const duration = p.chargeStarted > 0 && c.held && now - c.lease <= HEAT.lease ? now - p.chargeStarted : 0;
        this.cancelWeapon(client.sessionId);
        if (p.weapon === 'iron' && ironDamage(duration) > 0) this.fire(client.sessionId, shot, duration);
      }
    });
    this.onMessage('weapon:ads', (client, value: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.ads = value === true && p.alive && p.connected && p.weapon === 'sniper' && !p.reloading && p.transitionCooldown <= 0;
    });
    this.onMessage('reload', (client) => this.reload(client.sessionId));
    this.onMessage('dev:scale', (client, payload: unknown) => {
      if (!DEV_SCALE_ENABLED || !this.runtime.has(client.sessionId)) return;
      const value = payload && typeof payload === 'object' ? (payload as { height?: unknown }).height : undefined;
      const height = validDevHeight(value);
      if (height === null || height === this.playerTuning.height) return;
      this.playerTuning = tuningForHeight(height);
      this.state.playerHeight = height;
      this.hitHistory.clear();
      // Input predictions made with the previous tuning cannot be replayed under the new tuning.
      this.runtime.forEach((r, id) => {
        r.queue.clear(); r.credit = 0; r.lastSeq = r.lastReceived;
        const p = this.state.players.get(id);
        if (p) p.ack = r.lastSeq;
      });
      this.broadcast('feed', { text: `DEV SCALE · ${height.toFixed(2)} mm` });
    });
  }

  onJoin(client: Client, options: { name?: string; protocol?: number }) {
    if (options?.protocol !== MOVEMENT_PROTOCOL) throw new Error('Game client and server versions differ; refresh the page.');
    const spawn = activeMap.spawns[this.spawnIndex++ % activeMap.spawns.length];
    const p = new PlayerState({ name: safeName(options?.name), x: spawn[0], y: spawn[1], z: spawn[2] });
    this.state.players.set(client.sessionId, p);
    this.runtime.set(client.sessionId, { queue: new Map(), lastReceived: 0, lastSeq: 0, credit: 0, lastShot: -Infinity, lastShotId: -1, reloadAt: 0, respawnAt: 0 });
    if (this.practice) { this.startMatch(); this.spawnBots(); }
    else if (this.state.players.size >= 2 && this.state.phase === 'waiting') this.startMatch();
    this.broadcast('feed', { text: `${p.name} connected` });
  }

  onDrop(client: Client) {
    this.cancelWeapon(client.sessionId);
    this.killChain.reset(client.sessionId);
    if (TRACE_MOVEMENT) console.log('MOVE_TRACE', JSON.stringify({ event: 'drop', player: client.sessionId }));
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    const r = this.runtime.get(client.sessionId); if (r) { r.queue.clear(); r.credit = 0; r.lastSeq = r.lastReceived; if (p) p.ack = r.lastSeq; }
    this.allowReconnection(client, 30);
  }

  onReconnect(client: Client) {
    if (TRACE_MOVEMENT) console.log('MOVE_TRACE', JSON.stringify({ event: 'reconnect', player: client.sessionId }));
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  onLeave(client: Client) {
    this.killChain.reset(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (p) this.broadcast('feed', { text: `${p.name} disconnected` });
    this.state.players.delete(client.sessionId);
    this.runtime.delete(client.sessionId);
    this.weapons.delete(client.sessionId);
    this.hitHistory.delete(client.sessionId);
    if (!this.practice && this.state.players.size < 2 && this.state.phase === 'playing') this.state.phase = 'waiting';
  }

  private startMatch() {
    this.killChain.clear();
    this.hitHistory.clear();
    this.weapons.clear();
    this.drops.clear();
    this.state.weaponPickups.forEach((pickup, id) => { if (pickup.dropped) this.state.weaponPickups.delete(id); else { pickup.active = true; pickup.version++; } });
    this.weaponRespawns.clear();
    this.elapsed = 0; this.state.seconds = this.matchSeconds; this.state.winner = ''; this.state.phase = 'playing';
    this.state.players.forEach((p) => {
      if (Math.abs(p.x) >= activeMap.width / 2 || Math.abs(p.z) >= activeMap.depth / 2 || p.y < activeMap.ground - 1) {
        const spawn = activeMap.spawns[this.spawnIndex++ % activeMap.spawns.length], motion = initialMotion(spawn);
        p.x = motion.x; p.y = motion.y; p.z = motion.z; p.vy = motion.vy; p.grounded = true;
        p.side = 'front'; p.transitionCooldown = 0; p.flipCooldown = 0; p.headingOffset = 0;
      }
      p.jumpHeld = false; p.mantleTarget = 0; p.sniperReloadAt = 0; p.ads = false;
      p.weapon = 'solder'; p.specialWeapon = ''; p.heat = 0; p.overheated = false; p.triggerHeld = false; p.chargeStarted = 0; p.weaponReadyAt = 0;
      p.kills = 0; p.deaths = 0; p.hp = 100; p.alive = true; p.ammo = WEAPON.magazine; p.reserve = WEAPON.reserve; p.reloading = false;
    });
    this.runtime.forEach((r, id) => { r.queue.clear(); r.credit = 0; r.lastSeq = r.lastReceived; r.lastShot = -Infinity; r.lastShotId = -1; r.reloadAt = 0; const p = this.state.players.get(id); if (p) p.ack = r.lastSeq; });
    this.state.pickups.forEach((pickup) => { pickup.active = true; }); this.pickupRespawns.clear();
    this.broadcast('feed', { text: 'Match started' });
  }

  private tick() {
    const workStart = performance.now();
    const now = Date.now() / 1000;
    for (const [id, at] of this.weaponRespawns) if (now >= at) { const pickup = this.state.weaponPickups.get(id); if (pickup) pickup.active = true; this.weaponRespawns.delete(id); }
    for (const [id, drop] of this.drops) if (now >= drop.expiresAt) { this.state.weaponPickups.delete(id); this.drops.delete(id); }
    const tickAt = performance.now();
    const elapsed = Math.max(0, Math.min((tickAt - this.lastTickAt) / 1000, 1));
    this.lastTickAt = tickAt;
    this.state.pickups.forEach((pickup, id) => { if (!pickup.active && now >= (this.pickupRespawns.get(id) ?? Infinity)) { pickup.active = true; this.pickupRespawns.delete(id); } });
    if (this.state.phase === 'playing' && !this.practice) {
      this.elapsed += elapsed;
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
      if (!p.npc) {
        const c = this.weaponControl(id);
        if (c.held && (now - c.lease > HEAT.lease || !p.alive || !p.connected || p.reloading || p.transitionCooldown > 0)) this.cancelWeapon(id);
        if (!c.held || p.weapon !== 'air' || p.overheated) p.heat = Math.max(0, p.heat - (now - c.heatAt) / HEAT.cooling);
        c.heatAt = now; if (p.overheated && p.heat <= .001) { p.heat = 0; p.overheated = false; }
        if (p.weapon === 'air' && c.held && !p.overheated && now - c.pulse >= HEAT.pulse) {
          c.pulse = now; this.fire(id, c.shot, undefined, true);
        }
      }
      if (!p.alive) { if (now >= r.respawnAt && this.state.phase !== 'ended') this.respawn(id); return; }
      if (p.sniperReloadAt > 0 && now >= p.sniperReloadAt) {
        p.sniperReloadAt = 0;
        if (p.weapon === 'sniper') { p.ammo = 1; p.reserve = 1; p.reloading = false; }
        else this.weaponControl(id).stocks.set('sniper', { ammo: 1, reserve: 1 });
      }
      if (p.reloading && p.weapon !== 'sniper' && now >= r.reloadAt) {
        const count = Math.min(WEAPONS[p.weapon as WeaponId].magazine - p.ammo, p.reserve);
        p.ammo += count; p.reserve -= count; p.reloading = false;
      }
      if (!p.connected) return;
      if (p.npc && !this.state.npcMovement) { r.credit = 0; return; }
      r.credit = Math.min(60, r.credit + elapsed / TICK);
      if (p.npc) {
        const bot = this.bots.get(id)!;
        if (now >= bot.next) { bot.next = now + 1 + Math.random() * 2; bot.yaw = Math.random() * Math.PI * 2; bot.moving = bot.mode !== 0 && Math.random() > .2; bot.sprint = bot.mode === 2 && Math.random() < .4; if (!bot.moving) bot.next = now + .5 + Math.random() * 1.5; }
        if (Math.abs(p.x) > activeMap.width / 2 - 3 || Math.abs(p.z) > activeMap.depth / 2 - 3) bot.yaw = Math.atan2(p.x, p.z) - p.headingOffset;
        for (let i = 0; i < Math.floor(r.credit); i++) {
          const seq = ++r.lastReceived;
          r.queue.set(seq, { seq, forward: bot.moving ? 1 : 0, strafe: 0, yaw: bot.yaw, pitch: 0, jump: bot.mode === 2 && bot.moving && Math.random() < .006, sprint: bot.sprint });
        }
      }
      let processed = 0;
      while (r.credit >= 1 && r.queue.has(r.lastSeq + 1) && processed < 60) {
        const input = r.queue.get(r.lastSeq + 1)!;
        r.queue.delete(input.seq);
        const motion = stepMotion({ x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded, jumpHeld: p.jumpHeld, mantleTarget: p.mantleTarget, side: p.side as BoardSide, transitionCooldown: p.transitionCooldown, flipCooldown: p.flipCooldown, headingOffset: p.headingOffset }, input, activeMap, TICK, undefined, this.playerTuning);
        p.x = motion.x; p.y = motion.y; p.z = motion.z; p.vy = motion.vy; p.grounded = motion.grounded; p.jumpHeld = motion.jumpHeld; p.mantleTarget = motion.mantleTarget;
        p.side = motion.side ?? 'front'; p.transitionCooldown = motion.transitionCooldown ?? 0; p.flipCooldown = motion.flipCooldown ?? 0; p.headingOffset = motion.headingOffset ?? 0;
        p.yaw = input.yaw; p.pitch = input.pitch;
        r.lastSeq = input.seq; p.ack = input.seq; r.credit--; processed++;
        if (p.y < activeMap.ground - PLAYER.fallDeathDepth) { this.fall(id, now); break; }
        if (TRACE_MOVEMENT) console.log('MOVE_TRACE', JSON.stringify({ event: 'process', player: id, seq: input.seq, ack: p.ack, queue: r.queue.size, position: [p.x, p.y, p.z] }));
      }
      serverPerf.processed += processed;
      serverPerf.queueMax = Math.max(serverPerf.queueMax, r.queue.size);
      serverPerf.queueTotal += r.queue.size;
      if (!r.queue.size) r.credit = Math.min(r.credit, 6);
      if (!p.alive) return;
      if (p.weapon === 'solder' && p.reserve < WEAPON.maxReserve) this.state.pickups.forEach((pickup, pickupId) => {
        if (pickup.side !== p.side || !pickup.active || Math.hypot(p.x - pickup.x, p.z - pickup.z) > PLAYER_PICKUP_DISTANCE * this.playerTuning.height / PLAYER.height || Math.abs(p.y - pickup.y) > 1.5 * this.playerTuning.height / PLAYER.height) return;
        p.reserve = Math.min(WEAPON.maxReserve, p.reserve + WEAPON.pickupRounds);
        pickup.active = false; this.pickupRespawns.set(pickupId, now + this.pickupSeconds);
        this.broadcast('pickup', { player: id, amount: WEAPON.pickupRounds });
      });
    });
    this.state.serverTime = Date.now();
    this.recordPositions(this.state.serverTime);
    const workMs = performance.now() - workStart;
    serverPerf.ticks++; serverPerf.tickMsTotal += workMs; serverPerf.tickMsMax = Math.max(serverPerf.tickMsMax, workMs);
  }

  private reload(id: string) {
    const p = this.state.players.get(id), r = this.runtime.get(id);
    this.cancelWeapon(id);
    if (!p || !r || !p.alive || p.reloading || p.weapon === 'air' || p.ammo === WEAPONS[p.weapon as WeaponId].magazine || p.reserve === 0) return;
    p.reloading = true; p.ads = false; r.reloadAt = Date.now() / 1000 + WEAPONS[p.weapon as WeaponId].reloadSeconds;
    if (p.weapon === 'sniper' && !p.sniperReloadAt) p.sniperReloadAt = r.reloadAt;
  }

  private fall(id: string, now: number) {
    const p = this.state.players.get(id), r = this.runtime.get(id);
    if (!p || !r || !p.alive) return;
    this.dropSpecial(id);
    p.hp = 0; p.alive = false; p.deaths++; p.reloading = false; p.mantleTarget = 0; p.ads = false; p.sniperReloadAt = 0;
    this.cancelWeapon(id);
    r.respawnAt = now + RESPAWN_SECONDS;
    this.hitHistory.delete(id);
    r.queue.clear(); r.credit = 0; r.lastSeq = r.lastReceived; p.ack = r.lastSeq;
    this.broadcast('feed', { text: `${p.name} fell off the PCB` });
  }

  private recordPositions(time: number) {
    this.state.players.forEach((p, id) => {
      if (!p.alive || !p.connected) { this.hitHistory.delete(id); return; }
      const samples = this.hitHistory.get(id) ?? [];
      samples.push({ time, x: p.x, y: p.y, z: p.z, side: p.side as BoardSide });
      while (samples.length && samples[0].time < time - COMBAT.historyMs) samples.shift();
      this.hitHistory.set(id, samples);
    });
  }

  private shoot(client: Client, payload: unknown) {
    this.fire(client.sessionId, payload);
  }
  private fire(id: string, payload: unknown, charge?: number, heatPulse = false) {
    const p = this.state.players.get(id), r = this.runtime.get(id);
    const nowMs = Date.now(), now = nowMs / 1000;
    // Legacy empty shot messages remain valid for test clients; browser clients
    // send their instantaneous aim and the timestamp of what they actually saw.
    if (payload !== undefined && payload !== null && !validShotInput(payload)) return;
    const shot: ShotInput | undefined = payload === undefined || payload === null ? undefined : payload as ShotInput;
    if (!p || p.npc || !r || !p.alive || !p.connected || this.state.phase !== 'playing' || p.reloading || p.transitionCooldown > 0) return;
    const config = WEAPONS[p.weapon as WeaponId];
    if ((p.weapon === 'iron' && charge === undefined) || (p.weapon === 'air' && !heatPulse)) return;
    if (now - r.lastShot < config.fireInterval || now < p.weaponReadyAt) return;
    if (shot && ((!heatPulse && shot.shotId <= r.lastShotId) || shot.seq > r.lastReceived + 1 || shot.seq < r.lastSeq - 120)) return;
    if (p.weapon !== 'air' && p.ammo <= 0) { this.reload(id); return; }
    if (shot) r.lastShotId = shot.shotId;
    r.lastShot = now; p.weaponReadyAt = now + config.fireInterval;
    if (p.weapon === 'air') { p.heat = Math.min(1, p.heat + HEAT.pulse / HEAT.duration); if (p.heat >= .999) p.overheated = true; }
    else p.ammo--;
    const baseYaw = movementYaw(shot?.yaw ?? p.yaw, p as unknown as Motion), basePitch = shot?.pitch ?? p.pitch;
    const [shotYaw, shotPitch] = p.weapon === 'sniper' ? sniperAim(baseYaw, basePitch, p.ads) : [baseYaw, basePitch];
    const ray = aimRay(p.x, p.y, p.z, shotYaw, shotPitch, this.playerTuning);
    const viewTime = shot?.viewTime === undefined ? nowMs : Math.min(nowMs, Math.max(nowMs - COMBAT.maxRewindMs, shot.viewTime));
    const opponents = [...this.state.players.entries()].filter(([otherId, other]) => otherId !== id && other.alive && other.connected && other.side === p.side).map(([otherId, other]) => {
      const historical = p.weapon === 'air' ? undefined : samplePosition(this.hitHistory.get(otherId) ?? [], viewTime);
      const position = historical?.side === other.side ? historical : other;
      return [otherId, { x: position.x, y: position.y, z: position.z, side: other.side } as Motion] as [string, Motion];
    });
    if (p.weapon !== 'solder') {
      const rays = p.weapon === 'pump' ? pumpRays(p.x, p.y, p.z, movementYaw(shot?.yaw ?? p.yaw, p as unknown as Motion), shot?.pitch ?? p.pitch, this.playerTuning) : [ray];
      const result = weaponHits(p.weapon as WeaponId, ray, rays, activeMap, opponents, id, this.playerTuning, p.side as BoardSide, p.weapon === 'iron' ? ironDamage(charge!) : config.damage);
      for (const trace of result.traces) this.broadcast('shot', { shooter: id, side: p.side, weapon: p.weapon, ...trace });
      for (const [target, amount] of result.hits) this.damage(id, target, amount, now);
      if (p.weapon !== 'air' && p.ammo === 0 && p.reserve > 0) this.reload(id);
      return;
    }
    const result = hitscan(ray, activeMap, opponents, id, this.playerTuning, p.side as BoardSide);
    const end = ray.origin.map((v, i) => v + ray.direction[i] * result.distance);
    this.broadcast('shot', { shooter: id, shotId: shot?.shotId, side: p.side, from: ray.origin, to: end, hit: result.target });
    if (p.ammo === 0 && p.reserve > 0) this.reload(id);
    if (!result.target) return;
    this.damage(id, result.target, WEAPON.damage, now);
  }
  private damage(id: string, targetId: string, amount: number, now: number) {
    const p = this.state.players.get(id), target = this.state.players.get(targetId); if (!p || !target || !target.alive) return;
    target.hp = Math.max(0, target.hp - amount);
    const feedback = { target: targetId, shooter: id, amount, eliminated: target.hp === 0, side: target.side, x: target.x, y: target.y, z: target.z };
    // Victim needs the damage flash; only the attacker needs hit/number feedback.
    for (const client of this.clients) if (client.sessionId === id || client.sessionId === targetId) client.send('damage', feedback);
    if (target.hp === 0) {
      this.dropSpecial(targetId);
      target.alive = false; target.deaths++; p.kills++; target.ads = false; target.sniperReloadAt = 0;
      this.cancelWeapon(targetId);
      this.hitHistory.delete(targetId);
      const targetRuntime = this.runtime.get(targetId); if (targetRuntime) targetRuntime.respawnAt = now + (target.npc ? 3 : RESPAWN_SECONDS);
      this.killChain.reset(targetId);
      const chain = this.killChain.record(id, now * 1000);
      this.clients.find(client => client.sessionId === id)?.send('elimination', { target: targetId, name: target.name, chain });
      this.broadcast('feed', { text: weaponKillMessage(p.weapon as WeaponId, p.name, target.name), chain });
    }
  }

  private respawn(id: string) {
    this.killChain.reset(id);
    const p = this.state.players.get(id); if (!p) return;
    this.hitHistory.delete(id);
    const spawn = p.npc ? this.botSpawn(Number(id.slice(4))) : activeMap.spawns[this.spawnIndex++ % activeMap.spawns.length];
    const m = initialMotion(spawn);
    p.x = m.x; p.y = m.y; p.z = m.z; p.vy = 0; p.grounded = true; p.jumpHeld = false; p.mantleTarget = 0;
    p.side = 'front'; p.transitionCooldown = 0; p.flipCooldown = 0; p.headingOffset = 0;
    this.cancelWeapon(id); this.weapons.delete(id); p.weapon = 'solder'; p.specialWeapon = ''; p.heat = 0; p.overheated = false; p.weaponReadyAt = 0; p.sniperReloadAt = 0; p.ads = false;
    p.hp = 100; p.alive = true; p.ammo = WEAPON.magazine; p.reserve = WEAPON.reserve; p.reloading = false;
    const r = this.runtime.get(id); if (r) { r.queue.clear(); r.credit = 0; r.lastSeq = r.lastReceived; p.ack = r.lastSeq; }
    this.broadcast('feed', { text: `${p.name} respawned` });
  }

  private botSpawn(index: number): [number, number, number] {
    const human = [...this.state.players.values()].find(p => !p.npc);
    const origin = human ?? { x: activeMap.spawns[0][0], z: activeMap.spawns[0][2] };
    for (let radius = 4; radius <= 18; radius += 2) for (let k = 0; k < 32; k++) {
      const angle = (k + index * 6) * Math.PI / 16;
      const x = origin.x + Math.sin(angle) * radius, z = origin.z - Math.cos(angle) * radius;
      if (Math.abs(x) > activeMap.width / 2 - 2 || Math.abs(z) > activeMap.depth / 2 - 2) continue;
      if (activeMap.boxes.some(b => x + this.playerTuning.radius > b.min[0] && x - this.playerTuning.radius < b.max[0] && z + this.playerTuning.radius > b.min[2] && z - this.playerTuning.radius < b.max[2])) continue;
      let reachable = true;
      for (let step = 1; step <= Math.ceil(radius * 4); step++) {
        const t = step / Math.ceil(radius * 4), px = origin.x + (x - origin.x) * t, pz = origin.z + (z - origin.z) * t;
        if (activeMap.boxes.some(b => px + this.playerTuning.radius > b.min[0] && px - this.playerTuning.radius < b.max[0] && pz + this.playerTuning.radius > b.min[2] && pz - this.playerTuning.radius < b.max[2])) { reachable = false; break; }
      }
      if (!reachable) continue;
      if ([...this.state.players.values()].some(p => p.npc && Math.hypot(p.x - x, p.z - z) < 1)) continue;
      return [x, activeMap.ground, z];
    }
    return activeMap.spawns[index % activeMap.spawns.length];
  }

  private spawnBots() {
    for (let i = 0; i < 5; i++) {
      const id = `npc-${i}`, spawn = this.botSpawn(i);
      this.state.players.set(id, new PlayerState({ npc: true, name: `${i === 0 ? 'Precision' : i < 3 ? 'Walking' : 'Dynamic'} ${i + 1}`, x: spawn[0], y: spawn[1], z: spawn[2] }));
      this.bots.set(id, { mode: i === 0 ? 0 : i < 3 ? 1 : 2, next: 0, yaw: 0, moving: false, sprint: false });
      this.runtime.set(id, { queue: new Map(), lastReceived: 0, lastSeq: 0, credit: 0, lastShot: -Infinity, lastShotId: -1, reloadAt: 0, respawnAt: 0 });
    }
  }
  private equipWeapon(id: string, value: WeaponId) {
    const p = this.state.players.get(id), r = this.runtime.get(id); if (!p?.alive || !r) return;
    const c = this.weaponControl(id); c.stocks.set(p.weapon as WeaponId, { ammo: p.ammo, reserve: p.reserve });
    this.cancelWeapon(id); p.reloading = false; p.ads = false; r.reloadAt = 0;
    const config = WEAPONS[value], stock = c.stocks.get(value) ?? { ammo: config.magazine, reserve: config.reserve };
    p.weapon = value; if (this.practice) p.specialWeapon = value === 'solder' ? '' : value;
    p.ammo = stock.ammo; p.reserve = stock.reserve; p.weaponReadyAt = Math.max(p.weaponReadyAt, r.lastShot + config.fireInterval);
    if (value === 'sniper' && p.sniperReloadAt > 0) { p.ammo = 0; p.reloading = true; r.reloadAt = p.sniperReloadAt; }
  }
  onDispose() { this.drops.clear(); this.weaponRespawns.clear(); this.weapons.clear(); this.bots.clear(); this.runtime.clear(); this.hitHistory.clear(); }
}

export class PracticeRoom extends GameRoom { practice = true; }

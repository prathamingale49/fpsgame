import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Client, type Room } from '@colyseus/sdk';
import { aimRay, EYE_HEIGHT, initialMotion, stepMotion, testMap, TICK, WEAPON, type Input, type MapData, type Motion } from '../shared/game';
import type { MatchState, PlayerState } from '../server/state';
import './style.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#10251d'); scene.fog = new THREE.Fog('#10251d', 55, 185);
const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 260);
const light = new THREE.HemisphereLight(0xddeac8, 0x1b3025, 2.4); scene.add(light);
const sun = new THREE.DirectionalLight(0xfff2d4, 2.6); sun.position.set(-25, 65, 30); scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const boardMat = new THREE.MeshStandardMaterial({ color: '#2e5a26', roughness: .84, metalness: .12 });
const copper = new THREE.MeshStandardMaterial({ color: '#d7ae4a', roughness: .35, metalness: .72 });
const dark = new THREE.MeshStandardMaterial({ color: '#111c1a', roughness: .72, metalness: .14 });
const pale = new THREE.MeshStandardMaterial({ color: '#eee9d8', roughness: .67 });
const red = new THREE.MeshStandardMaterial({ color: '#772921', roughness: .42, metalness: .35 });
const playerMaterials = ['#dd704e', '#82cddd', '#c9dc6b', '#c999e6', '#f3c669', '#e588ad', '#86d0a5', '#b1b5ff'].map(color => new THREE.MeshStandardMaterial({ color, roughness: .6 }));
let map: MapData = testMap;
let room: Room<MatchState> | null = null;
let local: Motion = initialMotion(testMap.spawns[0]);
let yaw = 0, pitch = 0, seq = 0, accumulator = 0, mouseDown = false, lastShot = 0;
let sensitivity = Number(localStorage.getItem('pcb-sensitivity')) || .0022;
let volume = Number(localStorage.getItem('pcb-volume') ?? '.25');
let audioContext: AudioContext | null = null;
let pending: Input[] = [];
let snapshot: MatchState | null = null;
const keys = new Set<string>();
const remotes = new Map<string, { mesh: THREE.Group; target: THREE.Vector3; yaw: number }>();
const shots: { line: THREE.Line; born: number }[] = [];
let playerColorIndex = 0;

function boxMesh(box: { min: number[]; max: number[]; name?: string }, mat: THREE.Material): THREE.Mesh {
  const size = new THREE.Vector3(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
  mesh.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
  mesh.castShadow = false; mesh.receiveShadow = true; return mesh;
}
function buildMap(data: MapData) {
  world.clear(); map = data;
  canvas.dataset.modelLoaded = map.model ? 'false' : 'true';
  const board = new THREE.Mesh(new THREE.BoxGeometry(map.width, .45, map.depth), boardMat);
  board.position.y = map.ground - .225; world.add(board);
  if (map.texture) {
    new THREE.TextureLoader().load(map.texture, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const art = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), new THREE.MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -2 }));
      art.rotation.x = -Math.PI / 2; art.position.y = map.ground + .018; world.add(art);
    });
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(map.width + 2, .6, map.depth + 2), dark); edge.position.y = map.ground - .75; world.add(edge);
  // Procedural pads and traces keep the prototype readable before artwork is supplied.
  if (!map.model) {
    const padGeo = new THREE.CylinderGeometry(.25, .25, .015, 12);
    for (let z = -map.depth / 2 + 6; z < map.depth / 2 - 5; z += 4) for (let x = -map.width / 2 + 5; x < map.width / 2 - 4; x += 4) {
      if (Math.random() < .35) continue;
      const pad = new THREE.Mesh(padGeo, copper); pad.position.set(x, .012, z); world.add(pad);
    }
    for (let i = 0; i < 45; i++) {
      const points = [new THREE.Vector3(-map.width / 2 + 4, .012, -map.depth / 2 + 3 + i * 1.4), new THREE.Vector3(-map.width / 2 + 18, .012, -map.depth / 2 + 3 + i * 1.4), new THREE.Vector3(-map.width / 2 + 22, .012, -map.depth / 2 + 7 + i * 1.4)];
      const curve = new THREE.CatmullRomCurve3(points);
      world.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, .045, 4, false), copper));
    }
    map.boxes.forEach((box, i) => world.add(boxMesh(box, box.name?.startsWith('C') ? red : box.name?.startsWith('U') ? dark : i < 4 ? pale : copper)));
  } else {
    new GLTFLoader().load(map.model, gltf => {
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material.transparent && material.opacity < .5) { material.opacity = .035; material.depthWrite = false; }
      });
      world.add(gltf.scene); canvas.dataset.modelLoaded = 'true';
    }, undefined, error => { console.error('PCB model load failed', error); canvas.dataset.modelLoaded = 'error'; map.boxes.forEach(box => world.add(boxMesh(box, dark))); });
  }
  // Under-board staging gives a sense of miniature scale without blocking play.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(map.width + 35, 2, map.depth + 35), new THREE.MeshStandardMaterial({ color: '#172b24', roughness: 1 }));
  platform.position.y = map.ground - 2.7; world.add(platform);
}
buildMap(map);

function makePlayer(index: number): THREE.Group {
  const group = new THREE.Group(); const suit = playerMaterials[index % playerMaterials.length];
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.39, .47, 1.1, 8), suit); body.position.y = 1.02; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.37, 12, 8), pale); head.position.y = 1.83; group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.52, .22, .08), dark); visor.position.set(0, 1.88, -.34); group.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.15, .14, .9), dark); gun.position.set(.32, 1.32, -.52); group.add(gun);
  return group;
}
const gunView = new THREE.Group(); camera.add(gunView); scene.add(camera);
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(.18, .22, .75), dark); gunBody.position.set(.43, -.36, -.75); gunView.add(gunBody);
const gunAccent = new THREE.Mesh(new THREE.BoxGeometry(.19, .07, .28), copper); gunAccent.position.set(.43, -.22, -.77); gunView.add(gunAccent);
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6), new THREE.MeshBasicMaterial({ color: '#f6f5b2' }));
muzzle.position.set(.43, -.33, -1.19); muzzle.visible = false; gunView.add(muzzle);
function sound(frequency: number, duration: number, wave: OscillatorType = 'sawtooth') {
  if (volume <= 0) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = wave; oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .45), audioContext.currentTime + duration);
    gain.gain.setValueAtTime(volume * .12, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* audio unavailable */ }
}

function showFeed(text: string) {
  const item = document.createElement('div'); item.textContent = text; el('kill-feed').prepend(item);
  setTimeout(() => item.remove(), 5000);
  while (el('kill-feed').children.length > 5) el('kill-feed').lastElementChild?.remove();
}
function flashHit() { el('hitmarker').classList.remove('hidden'); sound(1050, .08, 'sine'); setTimeout(() => el('hitmarker').classList.add('hidden'), 170); }
function flashDamage() { el('damage-flash').style.opacity = '.8'; sound(130, .2); setTimeout(() => el('damage-flash').style.opacity = '0', 180); }
function addTracer(from: number[], to: number[]) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#e7f49a', transparent: true, opacity: .9 }));
  scene.add(line); shots.push({ line, born: performance.now() });
}

function updateHud() {
  if (!room || !snapshot) return;
  const me = snapshot.players.get(room.sessionId) as PlayerState | undefined;
  if (!me) return;
  el('hp').textContent = String(me.hp); el('ammo').textContent = String(me.ammo); el('reserve').textContent = String(me.reserve);
  el('hp-bar').style.width = `${me.hp}%`; el('ammo-bar').style.width = `${me.ammo / WEAPON.magazine * 100}%`;
  el('timer').textContent = `${Math.floor(snapshot.seconds / 60).toString().padStart(2, '0')}:${(snapshot.seconds % 60).toString().padStart(2, '0')}`;
  el('player-count').textContent = `${snapshot.players.size} / 8 PLAYERS · ${snapshot.phase.toUpperCase()}`;
  el('death').classList.toggle('hidden', me.alive);
  el('winner').classList.toggle('hidden', snapshot.phase !== 'ended');
  el('winner').textContent = snapshot.phase === 'ended' ? `${snapshot.winner || 'NOBODY'} WINS` : '';
  const scores = [...snapshot.players.values()].sort((a, b) => b.kills - a.kills);
  el('scores').innerHTML = '<div><span>PLAYER</span><span>KILLS</span><span>DEATHS</span></div>' + scores.map(p => `<div><span>${escapeHtml(p.name)}${p.connected ? '' : ' (offline)'}</span><span>${p.kills}</span><span>${p.deaths}</span></div>`).join('');
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

function syncState(state: MatchState) {
  if (!state?.players) return;
  snapshot = state;
  if (!room) return;
  const me = state.players.get(room.sessionId);
  if (me) {
    const authoritative: Motion = { x: me.x, y: me.y, z: me.z, vy: me.vy, grounded: me.grounded };
    pending = pending.filter(input => input.seq > me.ack);
    local = pending.reduce((motion, input) => stepMotion(motion, input, map), authoritative);
    if (!me.alive || Math.hypot(local.x - me.x, local.z - me.z) > 12) { local = authoritative; pending = []; }
  }
  const present = new Set<string>();
  state.players.forEach((p, id) => {
    if (id === room!.sessionId || !p.alive || !p.connected) return;
    present.add(id);
    let entry = remotes.get(id);
    if (!entry) { const mesh = makePlayer(playerColorIndex++); scene.add(mesh); entry = { mesh, target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw }; mesh.position.copy(entry.target); remotes.set(id, entry); }
    entry.target.set(p.x, p.y, p.z); entry.yaw = p.yaw;
  });
  for (const [id, entry] of remotes) if (!present.has(id)) { scene.remove(entry.mesh); remotes.delete(id); }
  updateHud();
}

const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${import.meta.env.DEV ? '2567' : location.port || (location.protocol === 'https:' ? '443' : '80')}`;
const client = new Client(endpoint);
async function connect(mode: 'play' | 'create' | 'join' | 'reconnect') {
  el('error').textContent = '';
  const name = (el<HTMLInputElement>('name').value || 'Engineer').trim().slice(0, 18);
  const code = el<HTMLInputElement>('code').value.trim().toUpperCase();
  try {
    if (mode === 'join' && !code) { el('error').textContent = 'Enter a room code.'; return; }
    const token = sessionStorage.getItem('pcb-reconnection-token');
    room = mode === 'reconnect' && token ? await client.reconnect<MatchState>(token) : mode === 'join' ? await client.joinById<MatchState>(code, { name }) : mode === 'create' ? await client.create<MatchState>('pcb', { name }) : await client.joinOrCreate<MatchState>('pcb', { name });
    const me = room.state?.players?.get(room.sessionId);
    pending = []; seq = me?.ack ?? 0; yaw = me?.yaw ?? 0; pitch = me?.pitch ?? 0; accumulator = 0;
    const response = await fetch('/api/map');
    if (response.ok) buildMap(await response.json() as MapData);
    el('map-name').textContent = map.title.toUpperCase();
    el('room-label').textContent = `ROOM ${room.roomId} · COPY LINK`;
    el('room-label').style.pointerEvents = 'auto'; el('room-label').style.cursor = 'pointer';
    history.replaceState(null, '', `?room=${room.roomId}`);
    room.onStateChange(syncState);
    room.onMessage('feed', (msg: { text: string }) => showFeed(msg.text));
    room.onMessage('shot', (msg: { shooter: string; from: number[]; to: number[]; hit?: string }) => { addTracer(msg.from, msg.to); if (msg.shooter === room?.sessionId && msg.hit) flashHit(); });
    room.onMessage('damage', (msg: { target: string }) => { if (msg.target === room?.sessionId) flashDamage(); });
    room.onDrop(() => { mouseDown = false; pending = []; showFeed('Connection lost · reconnecting'); });
    room.onReconnect(() => { pending = []; sessionStorage.setItem('pcb-reconnection-token', room!.reconnectionToken); syncState(room!.state); showFeed('Connection restored'); });
    room.onLeave(() => { sessionStorage.removeItem('pcb-reconnection-token'); room = null; el('menu').classList.remove('hidden'); el('hud').classList.add('hidden'); document.exitPointerLock(); showFeed('Disconnected from room'); });
    sessionStorage.setItem('pcb-reconnection-token', room.reconnectionToken);
    if (room.state?.players) syncState(room.state);
    el('menu').classList.add('hidden'); el('hud').classList.remove('hidden');
    if (mode === 'reconnect') el('pause').classList.remove('hidden'); else void canvas.requestPointerLock();
  } catch (error) { if (mode === 'reconnect') sessionStorage.removeItem('pcb-reconnection-token'); el('error').textContent = error instanceof Error ? error.message : String(error); }
}
el('play').onclick = () => connect('play'); el('create').onclick = () => connect('create'); el('join').onclick = () => connect('join');
el('leave').onclick = () => { sessionStorage.removeItem('pcb-reconnection-token'); room?.leave(); };
el('room-label').onclick = () => { if (!room) return; navigator.clipboard.writeText(location.href).then(() => showFeed('Invite link copied')); };
el('controls-toggle').onclick = () => { el('menu-detail').classList.remove('hidden'); el('menu-detail').innerHTML = 'WASD move · Mouse aim · Click shoot · Space jump · Shift sprint · R reload · Tab scoreboard · Esc pause'; };
el('settings-toggle').onclick = () => {
  el('menu-detail').classList.remove('hidden');
  el('menu-detail').innerHTML = `<label for="sensitivity">MOUSE SENSITIVITY</label><input id="sensitivity" type="range" min=".0008" max=".005" step=".0001" value="${sensitivity}"><label for="volume">SOUND VOLUME</label><input id="volume" type="range" min="0" max="1" step=".05" value="${volume}">`;
  el<HTMLInputElement>('sensitivity').oninput = e => { sensitivity = Number((e.target as HTMLInputElement).value); localStorage.setItem('pcb-sensitivity', String(sensitivity)); };
  el<HTMLInputElement>('volume').oninput = e => { volume = Number((e.target as HTMLInputElement).value); localStorage.setItem('pcb-volume', String(volume)); };
};
const invite = new URLSearchParams(location.search).get('room'); if (invite) el<HTMLInputElement>('code').value = invite.toUpperCase();
if (sessionStorage.getItem('pcb-reconnection-token')) void connect('reconnect');
document.addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Tab') { e.preventDefault(); el('scoreboard').classList.remove('hidden'); } if (e.code === 'KeyR' && room) { room.send('reload'); sound(420, .09, 'square'); } });
document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') el('scoreboard').classList.add('hidden'); });
document.addEventListener('mousemove', e => { if (document.pointerLockElement !== canvas) return; yaw -= e.movementX * sensitivity; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * sensitivity)); });
canvas.addEventListener('mousedown', e => { if (e.button === 0) { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); mouseDown = true; } });
document.addEventListener('mouseup', () => mouseDown = false);
document.addEventListener('pointerlockchange', () => el('pause').classList.toggle('hidden', !room || document.pointerLockElement === canvas));
el('pause').onclick = e => { if ((e.target as HTMLElement).id !== 'leave') canvas.requestPointerLock(); };

let previous = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - previous) / 1000, .25); previous = now; accumulator += dt;
  if (room && snapshot) {
    const me = snapshot.players.get(room.sessionId);
    while (accumulator >= TICK) {
      accumulator -= TICK;
      if (me?.alive && !room.reconnection.isReconnecting && document.pointerLockElement === canvas) {
        const input: Input = { seq: ++seq, forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')), strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), yaw, pitch, jump: keys.has('Space'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') };
        local = stepMotion(local, input, map); pending.push(input); if (pending.length > 240) pending.shift();
        room.send('input', input);
      }
    }
    if (mouseDown && document.pointerLockElement === canvas && me?.alive && now - lastShot >= WEAPON.fireInterval * 1000) { room.send('shoot'); lastShot = now; gunView.position.z = -.09; muzzle.visible = true; sound(235, .07); }
    camera.position.set(local.x, local.y + EYE_HEIGHT, local.z);
    canvas.dataset.position = `${local.x.toFixed(2)},${local.y.toFixed(2)},${local.z.toFixed(2)}`;
    camera.rotation.order = 'YXZ'; camera.rotation.y = yaw; camera.rotation.x = pitch; camera.rotation.z = 0;
    gunView.position.z += (0 - gunView.position.z) * Math.min(1, dt * 16);
    if (now - lastShot > 45) muzzle.visible = false;
  } else {
    accumulator = 0;
    const t = now * .00015; camera.position.set(Math.sin(t) * 30, 24, Math.cos(t) * 30); camera.lookAt(0, 0, 0);
  }
  for (const entry of remotes.values()) { entry.mesh.position.lerp(entry.target, Math.min(1, dt * 12)); entry.mesh.rotation.y += Math.atan2(Math.sin(entry.yaw - entry.mesh.rotation.y), Math.cos(entry.yaw - entry.mesh.rotation.y)) * Math.min(1, dt * 12); }
  for (let i = shots.length - 1; i >= 0; i--) if (now - shots[i].born > 120) { scene.remove(shots[i].line); shots[i].line.geometry.dispose(); (shots[i].line.material as THREE.Material).dispose(); shots.splice(i, 1); }
  const width = innerWidth, height = innerHeight;
  if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) { renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

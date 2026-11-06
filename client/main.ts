import * as THREE from 'three';
import { PRACTICE_MAPS } from '../shared/maps';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Client, type Room } from '@colyseus/sdk';
import { nearestFlipEdge, aimRay, collisionCacheStats, movementYaw, samplePosition, hitscan, COMBAT, DEV_SCALE, EDGE_FLIP_SECONDS, FLIP_COOLDOWN_SECONDS, JUMP_HEIGHT_RATIO, PLAYER, initialMotion, MOVEMENT_PROTOCOL, stepMotion, testMap, TICK, WEAPON, tuningForHeight, type Input, type MapData, type Motion, type BoardSide, type PositionSample, type ShotInput } from '../shared/game';
import type { MatchState, PlayerState } from '../server/state';
import './style.css';
import { validWeaponId, WEAPONS, WEAPON_IDS, CHARGE, HEAT, type WeaponId } from '../shared/weapons';
import { createWeaponModel, animateWeapon, disposeWeaponModel } from './weapon-models';
import { WEAPON_PICKUPS } from '../shared/weapon-pickups';
import { EdgeOrbit } from './edge-orbit';
import { mergeDamageNumber, damageNumberVisible, type DamageFeedback, type DamageNumber } from './damage-feedback';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.title = 'YJSPS · YJSP';
for (const brand of Array.from(document.querySelectorAll('.brand, .menu-card h1'))) brand.innerHTML = 'YJS<span>PS</span>';
const practiceButton = el<HTMLButtonElement>('practice');
let selectedPracticeMap = 'bms';
let switchingMap = false;
const mapsButton = document.createElement('button'); mapsButton.id = 'maps-toggle'; mapsButton.textContent = 'MAPS'; mapsButton.hidden = true;
mapsButton.setAttribute('aria-expanded', 'false'); mapsButton.setAttribute('aria-controls', 'maps-sidebar');
const mapsSidebar = document.createElement('aside'); mapsSidebar.id = 'maps-sidebar'; mapsSidebar.hidden = true;
mapsSidebar.innerHTML = '<header><strong>PRACTICE MAPS</strong><button id="maps-close" aria-label="Close maps">×</button></header><p>Choose a board. Targets reset when switching.</p><div id="map-options"></div><small>M · MAPS / ESC · CLOSE</small>';
el('hud').append(mapsButton, mapsSidebar);
for (const { id, title } of PRACTICE_MAPS) {
  const button = document.createElement('button'); button.dataset.mapId = id; button.textContent = title;
  button.onclick = () => { void switchPracticeMap(id); }; el('map-options').append(button);
}
function toggleMaps(open: boolean) {
  mapsSidebar.hidden = !open; mapsButton.setAttribute('aria-expanded', String(open));
  if (open) { document.exitPointerLock(); keys.clear(); mouseDown = false; cancelSpecial(); el('pause').classList.add('hidden'); }
}
mapsButton.onclick = () => toggleMaps(mapsSidebar.hidden);
el('maps-close').onclick = () => toggleMaps(false);
async function switchPracticeMap(id: string) {
  if (!room?.state.practice || switchingMap) return;
  if (map.id === id) { toggleMaps(false); return; }
  switchingMap = true; selectedPracticeMap = id;
  for (const button of Array.from(mapsSidebar.querySelectorAll('button'))) button.disabled = true;
  try { document.exitPointerLock(); await room.leave(); clearSessionVisuals(); await connect('practice'); }
  finally { switchingMap = false; for (const button of Array.from(mapsSidebar.querySelectorAll('button'))) button.disabled = false; }
}
const pickupPrompt = document.createElement('div'); pickupPrompt.id = 'pickup-prompt'; pickupPrompt.style.cssText = 'position:absolute;bottom:190px;width:100%;text-align:center;font:13px monospace;color:#ffcf4a;pointer-events:none'; el('hud').append(pickupPrompt);
const weaponPickupModels = new Map<string, THREE.Group>();
let nearbyWeapon: { id: string; version: number } | null = null, visualFireAt = 0;
let visualFireWeapon: WeaponId = 'solder';
let showNpcHitboxes = false;
const npcHitboxes = new Map<string, THREE.Box3Helper>();
const damageNumbers: (DamageNumber & { element: HTMLElement; roomId: string })[] = [];
const weaponStatus = document.createElement('div'); weaponStatus.id = 'weapon-status';
weaponStatus.style.cssText = 'position:absolute;right:28px;bottom:145px;color:#ffd24a;font:12px monospace;text-align:right;pointer-events:none';
el('hud').append(weaponStatus);
const weaponMeter = document.createElement('progress'); weaponMeter.id = 'weapon-meter'; weaponMeter.max = 1;
weaponMeter.style.cssText = 'position:absolute;right:28px;bottom:125px;width:200px;height:10px;accent-color:#ffd24a'; weaponMeter.hidden = true; el('hud').append(weaponMeter);
let specialHeld = false, fullChargeCue = false;
const currentWeapon = () => WEAPONS[(room?.state.players?.get(room.sessionId)?.weapon ?? 'solder') as WeaponId];
const weaponShot = (): ShotInput => ({ shotId: ++nextShotId, seq, yaw, pitch, viewTime: lastViewTime || undefined });
function cancelSpecial() { specialHeld = false; fullChargeCue = false; if (room) room.send('weapon:trigger', { action: 'cancel' }); }
const canvas = el<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let quality = localStorage.getItem('pcb-quality') || 'balanced';
const applyQuality = () => renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : quality === 'low' ? .75 : 1));
applyQuality();
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
let playerTuning = tuningForHeight(PLAYER.height);
let devScaleEnabled = false;
let lastSentInput: Input | null = null;
let nextInputAt = performance.now();
let yaw = 0, pitch = 0, seq = 0, mouseDown = false, lastShot = 0;
type BoardFlip = { orbit: EdgeOrbit; started: number; sourceHeading: number; progress: number };
let renderedHeading = 0;
const orbitTarget = new THREE.Vector3();
const orbitLook = new THREE.Quaternion();
const orbitEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let visualSide: BoardSide = 'front';
let boardFlip: BoardFlip | null = null;
let nextShotId = 0, serverClockOffsetMs = NaN, lastViewTime = 0;
let sensitivity = Number(localStorage.getItem('pcb-sensitivity')) || .0022;
let volume = Number(localStorage.getItem('pcb-volume') ?? '.25');
let audioContext: AudioContext | null = null;
let pending: Input[] = [];
let snapshot: MatchState | null = null;
const movementTrace = new URLSearchParams(location.search).has('movementTrace');
const soakTest = new URLSearchParams(location.search).has('soakTest');
type MovementTrace = { event: string; time: number; seq: number; ack: number; pending: number; predicted: [number, number, number]; authoritative: [number, number, number]; correction: number; yaw: number; forward: number };
const movementEvents: MovementTrace[] = [];
const movementSnapshots: { time: number; players: { id: string; ack: number; side: string; position: [number, number, number] }[] }[] = [];
let testMove: { remaining: number; yaw: number } | null = null;
let soakMode = false, soakTick = 0;
if (soakTest) (window as unknown as { __pcbStartSoak: () => void }).__pcbStartSoak = () => { soakMode = true; soakTick = 0; };
if (movementTrace) {
  (window as Window & { __pcbMovementTrace?: MovementTrace[] }).__pcbMovementTrace = movementEvents;
  (window as Window & { __pcbMovementSnapshots?: typeof movementSnapshots }).__pcbMovementSnapshots = movementSnapshots;
  (window as unknown as { __pcbStartMovementTest: (ticks: number, testYaw: number) => void }).__pcbStartMovementTest = (ticks, testYaw) => { yaw = testYaw; testMove = { remaining: ticks, yaw: testYaw }; };
}
function recordMovement(event: string, ack: number, correctionValue = 0, forward = 0) {
  if (!movementTrace) return;
  const me = room?.state?.players?.get(room.sessionId);
  movementEvents.push({ event, time: performance.now(), seq, ack, pending: pending.length, predicted: [local.x, local.y, local.z], authoritative: me ? [me.x, me.y, me.z] : [0, 0, 0], correction: correctionValue, yaw, forward });
  if (movementEvents.length > 4000) movementEvents.shift();
}
const keys = new Set<string>();
type RemotePlayer = { mesh: THREE.Group; healthBar: THREE.Group; healthFill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; samples: PositionSample[]; yaw: number; hp: number; displayedHp: number };
const remotes = new Map<string, RemotePlayer>();
const shots: { line: THREE.LineSegments | THREE.Line; born: number }[] = [];
const predictedTracers = new Map<number, THREE.Line>();
const spoolMeshes = new Map<string, THREE.Group>();
let correction = 0, collisionChecks = 0, ping = 0;
const debug = document.createElement('div'); debug.id = 'perf-debug'; debug.hidden = true; el('app').append(debug);
const scalePanel = document.createElement('aside');
scalePanel.id = 'scale-debug'; scalePanel.hidden = true;
scalePanel.innerHTML = `<div class="scale-debug-header"><strong>DEV · PLAYER SCALE</strong><button id="scale-close" type="button">×</button></div>
  <label for="scale-height">PLAYER HEIGHT <output id="scale-value">${PLAYER.height.toFixed(2)} mm</output></label>
  <input id="scale-height" type="range" min="${DEV_SCALE.min}" max="${DEV_SCALE.max}" step="${DEV_SCALE.step}" value="${PLAYER.height}">
  <div id="scale-metrics"></div>
  <p>Shared by the entire room. Jump apex and movement speed scale with player height. Release the slider to apply.</p>
  <button id="scale-resume" type="button">CLOSE &amp; RESUME</button>`;
el('app').append(scalePanel);
const scaleSlider = el<HTMLInputElement>('scale-height');
const scaleValue = el<HTMLOutputElement>('scale-value');
const scaleMetrics = el<HTMLDivElement>('scale-metrics');
function updateScaleReadout(height: number) {
  const tuning = tuningForHeight(height);
  scaleValue.textContent = `${height.toFixed(2)} mm`;
  scaleMetrics.textContent = `JUMP APEX ${(height * JUMP_HEIGHT_RATIO).toFixed(2)} mm (${JUMP_HEIGHT_RATIO.toFixed(2)}× height) · SPRINT ${tuning.sprintSpeed.toFixed(1)} mm/s · HITBOX ${(tuning.radius * 2).toFixed(2)} mm`;
}
updateScaleReadout(PLAYER.height);
scaleSlider.addEventListener('input', () => updateScaleReadout(Number(scaleSlider.value)));
scaleSlider.addEventListener('change', () => { if (room && devScaleEnabled) room.send('dev:scale', { height: Number(scaleSlider.value) }); });
function closeScalePanel() { scalePanel.hidden = true; if (room) void canvas.requestPointerLock(); }
el('scale-close').onclick = closeScalePanel;
el('scale-resume').onclick = closeScalePanel;
function applyPlayerHeight(height: number) {
  playerTuning = tuningForHeight(height);
  scaleSlider.value = height.toFixed(2);
  updateScaleReadout(height);
  gunView.scale.setScalar(.75 * height / 1.8);
  remotes.forEach(entry => entry.mesh.scale.setScalar(height / 2.48));
}
let showDebug = false, fpsFrames = 0, fpsStart = performance.now(), lastFrameTime = 0, renderCpuMs = 0;
const frameTimes: number[] = [];
const playCorrections: number[] = [];
const gl = renderer.getContext(), debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = debugRenderer ? String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
let maxPending = 0, maxCorrection = 0;
function sceneResources() {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  let objects = 0;
  scene.traverse(object => {
    objects++;
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  return { objects, geometries: geometries.size, materials: materials.size };
}
(window as unknown as { __pcbPerf: () => unknown }).__pcbPerf = () => ({
  frameTimes: [...frameTimes], playCorrections: [...playCorrections], pending: pending.length, maxPending, correction, maxCorrection,
  renderer: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  scene: sceneResources(), gpu, mapId: map.id, authoritativeMapId: room?.state.mapId,
  cache: collisionCacheStats(map), heapMB: ((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
  position: [local.x, local.y, local.z], authoritative: room?.state?.players?.get(room.sessionId) ? [room.state.players!.get(room.sessionId)!.x, room.state.players!.get(room.sessionId)!.y, room.state.players!.get(room.sessionId)!.z] : null,
  side: local.side ?? 'front', authoritativeSide: room?.state?.players?.get(room.sessionId)?.side,
  testRemaining: testMove?.remaining ?? 0,
  cameraRoll: camera.rotation.z, worldRotation: world.rotation.x,
  flipCooldown: local.flipCooldown ?? 0, orbitProgress: boardFlip?.progress ?? null, cameraPosition: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(),
});
(window as unknown as { __pcbResetPerfWindow: () => void }).__pcbResetPerfWindow = () => { frameTimes.length = 0; playCorrections.length = 0; };
let wasReloading = false;

function boxMesh(box: { min: number[]; max: number[]; name?: string }, mat: THREE.Material): THREE.Mesh {
  const size = new THREE.Vector3(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
  mesh.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
  mesh.castShadow = false; mesh.receiveShadow = true; return mesh;
}
function clearSessionVisuals() {
  snapshot = null; pending = []; keys.clear(); mouseDown = false; boardFlip = null;
  for (const entry of remotes.values()) {
    scene.remove(entry.mesh, entry.healthBar);
    entry.mesh.traverse(obj => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
    entry.healthBar.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); } });
  }
  remotes.clear();
  for (const helper of npcHitboxes.values()) { scene.remove(helper); helper.dispose(); } npcHitboxes.clear();
  for (const mesh of spoolMeshes.values()) { scene.remove(mesh); mesh.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); if (obj.material !== dark) (obj.material as THREE.Material).dispose(); } }); } spoolMeshes.clear();
  for (const mesh of weaponPickupModels.values()) { scene.remove(mesh); disposeWeaponModel(mesh.userData.weaponModel); mesh.traverse(obj => { if (obj instanceof THREE.Mesh && obj.geometry.type === 'CircleGeometry') { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); } }); } weaponPickupModels.clear();
  for (const shot of shots) { scene.remove(shot.line); shot.line.geometry.dispose(); (shot.line.material as THREE.Material).dispose(); } shots.length = 0; predictedTracers.clear();
  for (const number of damageNumbers) number.element.remove(); damageNumbers.length = 0;
  airCone.visible = false; showNpcHitboxes = false; specialHeld = false; adsHeld = false; fullChargeCue = false;
  el('kill-feed').replaceChildren(); el('hitmarker').classList.add('hidden'); el('damage-flash').style.opacity = '0';
}
function buildMap(data: MapData) {
  world.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (![boardMat, copper, dark, pale, red].includes(material)) {
      if ('map' in material) (material.map as THREE.Texture | null)?.dispose();
      material.dispose();
    }
  });
  world.clear(); map = data;
  const addBackFallback = () => {
    if (!map.back?.enabled) return;
    const back = new THREE.Group(); back.rotation.x = Math.PI; back.position.y = -map.back.thickness;
    for (const box of map.back.boxes) back.add(boxMesh(box, dark));
    world.add(back);
  };
  canvas.dataset.modelLoaded = map.model ? 'false' : 'true';
  const board = new THREE.Mesh(new THREE.BoxGeometry(map.width, .45, map.depth), boardMat);
  board.position.y = map.ground - .225; if (!map.surface) world.add(board);
  if (map.surface) {
    const data = map;
    for (const back of [false, true]) {
      const url = back ? data.backTexture : data.texture; if (!url) continue;
      new THREE.TextureLoader().load(url, texture => {
        if (map !== data) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        const positions: number[] = [], uv: number[] = [];
        const t = data.surface!;
        for (let i = 0; i < t.length; i += 6) for (const j of back ? [0, 2, 4] : [4, 2, 0]) {
          const x = t[i+j], z = t[i+j+1];
          positions.push(x, back ? -data.back!.thickness - .018 : .018, z);
          uv.push(back ? .5-x/data.width : .5+x/data.width, .5-z/data.depth);
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        world.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })));
      });
    }
  }
  if (map.texture && !map.surface) {
    new THREE.TextureLoader().load(data.texture!, texture => {
      if (map !== data) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const art = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), new THREE.MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -2 }));
      art.rotation.x = -Math.PI / 2; art.position.y = map.ground + .018; world.add(art);
    });
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(map.width + 2, .6, map.depth + 2), dark); edge.position.y = map.ground - .75; if (!map.surface) world.add(edge);
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
    addBackFallback();
  } else {
    new GLTFLoader().load(map.model, gltf => {
      // The importer emits the substrate as the first material group.
      const substrate = gltf.scene.children[0];
      if (data.boardColor && substrate instanceof THREE.Mesh) {
        const materials = Array.isArray(substrate.material) ? substrate.material : [substrate.material];
        for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) material.color.set(data.boardColor);
      }
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material.transparent && material.opacity < .5) { material.opacity = .035; material.depthWrite = false; }
      });
      if (map !== data) { gltf.scene.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) material.dispose(); } }); return; }
      world.add(gltf.scene); canvas.dataset.modelLoaded = 'true';
    }, undefined, error => { if (map !== data) return; console.error('PCB model load failed', error); canvas.dataset.modelLoaded = 'error'; map.boxes.forEach(box => world.add(boxMesh(box, dark))); addBackFallback(); });
  }
}
buildMap(map);

function makePlayer(id: string): THREE.Group {
  // Avatar meshes are recreated across sides and respawns; identity keeps their color stable.
  let index = 0;
  for (let i = 0; i < id.length; i++) index = (Math.imul(index, 31) + id.charCodeAt(i)) >>> 0;
  const group = new THREE.Group(); const suit = playerMaterials[index % playerMaterials.length];
  // An upright rocket-person: pointed nose, cylindrical suit, view window, fins and boots.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.34, .43, 1.15, 12), suit); body.position.y = 1; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.34, .72, 12), suit); nose.position.y = 1.94; group.add(nose);
  const noseTip = new THREE.Mesh(new THREE.ConeGeometry(.09, .16, 12), copper); noseTip.position.y = 2.38; group.add(noseTip);
  const window = new THREE.Mesh(new THREE.SphereGeometry(.235, 12, 8), dark); window.scale.set(1, .7, .35); window.position.set(0, 1.34, -.315); group.add(window);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 8), pale); glass.scale.set(1, .6, .2); glass.position.set(-.055, 1.38, -.394); group.add(glass);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.405, .405, .12, 12), copper); collar.position.y = .43; group.add(collar);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.23, .31, .25, 12), dark); nozzle.position.y = .25; group.add(nozzle);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.25, .7, .13), suit); fin.position.set(side * .47, .55, 0); fin.rotation.z = side * .24; group.add(fin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(.24, .21, .34), dark); boot.position.set(side * .24, .13, -.08); group.add(boot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .33, 4, 8), suit); arm.position.set(side * .44, 1.09, -.04); arm.rotation.z = side * .2; group.add(arm);
  }
  group.scale.setScalar(playerTuning.height / 2.48);
  return group;
}
function makeHealthBar(): { bar: THREE.Group; fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> } {
  const bar = new THREE.Group();
  const background = new THREE.Mesh(new THREE.PlaneGeometry(1.02, .16), new THREE.MeshBasicMaterial({ color: '#12221b', transparent: true, opacity: .9, side: THREE.DoubleSide }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(.96, .10), new THREE.MeshBasicMaterial({ color: '#36e26b', side: THREE.DoubleSide }));
  fill.position.z = .002;
  bar.add(background, fill);
  return { bar, fill };
}
const gunView = new THREE.Group(); camera.add(gunView); scene.add(camera);
const airCone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(HEAT.halfAngle) * WEAPONS.air.range, WEAPONS.air.range, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ff9d36', transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide }));
airCone.rotation.x = Math.PI / 2; airCone.position.set(.18, -.12, -.3 - WEAPONS.air.range / 2); airCone.visible = false; camera.add(airCone);
const heatPositions = new Float32Array(24 * 3);
const heatGeometry = new THREE.BufferGeometry(); heatGeometry.setAttribute('position', new THREE.BufferAttribute(heatPositions, 3));
const heatParticles = new THREE.Points(heatGeometry, new THREE.PointsMaterial({ color: '#ffb35a', size: .07, transparent: true, opacity: .65, depthWrite: false }));
heatParticles.position.set(.18, -.12, -.3); heatParticles.visible = false; camera.add(heatParticles);
gunView.scale.setScalar(.75 * PLAYER.height / 1.8);
const modelAnchor = new THREE.Group(); modelAnchor.position.set(.43, -.33, -1.15); gunView.add(modelAnchor);
const weaponModels = new Map(WEAPON_IDS.map(id => [id, createWeaponModel(id)]));
for (const model of weaponModels.values()) modelAnchor.add(model.root);
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

let eliminationTimer: ReturnType<typeof setTimeout> | undefined;
function clearElimination() {
  clearTimeout(eliminationTimer);
  el('elimination').classList.add('hidden');
}
function showElimination(msg: { name: string; chain: number }) {
  clearTimeout(eliminationTimer);
  el('elimination-name').textContent = msg.name;
  el('elimination-chain').textContent = msg.chain === 2 ? 'DOUBLE KILL' : msg.chain === 3 ? 'TRIPLE KILL' : msg.chain > 3 ? `${msg.chain} KILL STREAK` : '';
  el('elimination').classList.remove('hidden');
  eliminationTimer = setTimeout(clearElimination, 2200);
  // A clean rising chord distinguishes an elimination from the short hit tick.
  if (volume <= 0) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const notes = msg.chain >= 3 ? [660, 880, 1100, 1320] : msg.chain === 2 ? [660, 880, 1100] : [660, 990];
    notes.forEach((frequency, i) => {
      const at = audioContext!.currentTime + i * .065;
      const oscillator = audioContext!.createOscillator(), gain = audioContext!.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(.001, at); gain.gain.linearRampToValueAtTime(volume * .1, at + .008);
      gain.gain.exponentialRampToValueAtTime(.001, at + .18);
      oscillator.connect(gain).connect(audioContext!.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + .19);
    });
  } catch { /* audio unavailable */ }
}
function showFeed(text: string, chain = 1) {
  const item = document.createElement('div');
  const message = document.createElement('span'); message.textContent = text; item.append(message);
  if (chain >= 2) {
    item.classList.add('feed-streak');
    if (chain >= 3) item.classList.add('feed-streak-hot');
    const badge = document.createElement('strong'); badge.className = 'feed-streak-badge';
    badge.textContent = `x${chain}`; badge.setAttribute('aria-label', `${chain} consecutive eliminations`);
    item.append(badge);
  }
  el('kill-feed').prepend(item);
  setTimeout(() => item.remove(), 5000);
  while (el('kill-feed').children.length > 5) el('kill-feed').lastElementChild?.remove();
}
let hitTimer: ReturnType<typeof setTimeout> | undefined, lastHitSound = -Infinity;
function flashHit(eliminated = false) {
  clearTimeout(hitTimer); el('hitmarker').classList.remove('hidden'); el('hitmarker').classList.toggle('confirmed-kill', eliminated);
  if (!eliminated && performance.now() - lastHitSound > 80) { sound(1050, .045, 'sine'); lastHitSound = performance.now(); }
  hitTimer = setTimeout(() => el('hitmarker').classList.add('hidden'), eliminated ? 300 : 170);
}
function flashDamage() { el('damage-flash').style.opacity = '.8'; sound(130, .2); setTimeout(() => el('damage-flash').style.opacity = '0', 180); }
function makeSpool(): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#b7c9c1', metalness: .83, roughness: .3 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .28, 12), dark); core.rotation.z = Math.PI / 2; group.add(core);
  for (const side of [-.16, .16]) { const flange = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .07, 16), metal); flange.rotation.z = Math.PI / 2; flange.position.x = side; group.add(flange); }
  const solder = new THREE.Mesh(new THREE.TorusGeometry(.29, .065, 6, 18), metal); solder.rotation.y = Math.PI / 2; group.add(solder);
  return group;
}
function addTracer(from: number[], to: number[], color = '#e6e9d8'): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .9 }));
  scene.add(line); shots.push({ line, born: performance.now() });
  return line;
}
function addImpactSparks(from: number[], to: number[]) {
  const end = new THREE.Vector3(...to), start = new THREE.Vector3(...from);
  if (end.distanceTo(start) >= WEAPON.range - .01) return;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    points.push(end, end.clone().add(new THREE.Vector3(Math.cos(angle) * .22, .11 + (i % 2) * .11, Math.sin(angle) * .22)));
  }
  const sparks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#f5c66b' }));
  scene.add(sparks); shots.push({ line: sparks, born: performance.now() });
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
  if (state.playerHeight > 0 && Math.abs(state.playerHeight - playerTuning.height) > .0001) {
    applyPlayerHeight(state.playerHeight);
    // Never replay inputs predicted with the previous collision and jump parameters.
    pending = [];
  }
  if (movementTrace) {
    movementSnapshots.push({ time: performance.now(), players: [...state.players.entries()].map(([id, p]) => ({ id, ack: p.ack, side: p.side, position: [p.x, p.y, p.z] as [number, number, number] })) });
    if (movementSnapshots.length > 4000) movementSnapshots.shift();
  }
  snapshot = state;
  if (state.serverTime > 0) {
    // Clock synchronization is based on server-authored snapshot timestamps and
    // an RTT/2 estimate. A stable offset keeps visual interpolation monotonic.
    const candidate = Date.now() - state.serverTime - ping / 2;
    serverClockOffsetMs = Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs * .95 + candidate * .05 : candidate;
  }
  if (!room) return;
  const me = state.players.get(room.sessionId);
  if (me) {
    if (me.reloading && !wasReloading) sound(570, .22, 'triangle');
    wasReloading = me.reloading;
    const before = local;
    const authoritative: Motion = { x: me.x, y: me.y, z: me.z, vy: me.vy, grounded: me.grounded, jumpHeld: me.jumpHeld, mantleTarget: me.mantleTarget, side: me.side as BoardSide, transitionCooldown: me.transitionCooldown, flipCooldown: me.flipCooldown, headingOffset: me.headingOffset };
    pending = pending.filter(input => input.seq > me.ack);
    local = pending.reduce((motion, input) => stepMotion(motion, input, map, TICK, undefined, playerTuning), authoritative);
    correction = Math.hypot(local.x - before.x, local.y - before.y, local.z - before.z);
    maxCorrection = Math.max(maxCorrection, correction);
    if (me.alive && before.y >= map.ground - 1 && Math.abs(before.y - me.y) < 10) {
      playCorrections.push(correction); if (playCorrections.length > 2400) playCorrections.splice(0, 1200);
    }
    recordMovement('snapshot', me.ack, correction);
    if (!me.alive) { clearElimination(); local = authoritative; pending = []; }
  }
  const present = new Set<string>();
  state.players.forEach((p, id) => {
    if (id === room!.sessionId || !p.alive || !p.connected || p.side !== (local.side ?? 'front')) return;
    present.add(id);
    let entry = remotes.get(id);
    if (!entry) {
      const mesh = makePlayer(id);
      const { bar, fill } = makeHealthBar();
      scene.add(mesh, bar);
      entry = { mesh, healthBar: bar, healthFill: fill, samples: [], yaw: p.yaw, hp: p.hp, displayedHp: p.hp };
      mesh.position.set(p.x, p.y, p.z);
      remotes.set(id, entry);
    }
    if (state.serverTime > 0 && (entry.samples.at(-1)?.time ?? -Infinity) < state.serverTime) {
      entry.samples.push({ time: state.serverTime, x: p.x, y: p.y, z: p.z, side: p.side as BoardSide });
      while (entry.samples.length && entry.samples[0].time < state.serverTime - COMBAT.historyMs) entry.samples.shift();
    }
    entry.yaw = p.yaw + p.headingOffset; entry.hp = p.hp;
  });
  for (const [id, entry] of remotes) if (!present.has(id)) {
    scene.remove(entry.mesh, entry.healthBar);
    entry.mesh.traverse(obj => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
    entry.healthBar.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); } });
    remotes.delete(id);
  }
  state.pickups?.forEach((pickup, id) => {
    let mesh = spoolMeshes.get(id);
    if (!mesh) { mesh = makeSpool(); scene.add(mesh); spoolMeshes.set(id, mesh); }
    mesh.position.set(pickup.x, pickup.y + .32, pickup.z); mesh.visible = pickup.active && pickup.side === (local.side ?? 'front');
  });
  updateHud();
}

const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${import.meta.env.DEV ? '2567' : location.port || (location.protocol === 'https:' ? '443' : '80')}`;
const client = new Client(endpoint);
async function connect(mode: 'play' | 'create' | 'join' | 'reconnect' | 'practice') {
  el('error').textContent = '';
  const name = (el<HTMLInputElement>('name').value || 'Engineer').trim().slice(0, 18);
  const code = el<HTMLInputElement>('code').value.trim().toUpperCase();
  try {
    if (mode === 'join' && !code) { el('error').textContent = 'Enter a room code.'; return; }
    const health = await (await fetch('/api/health')).json() as { movementProtocol?: number; devScaleEnabled?: boolean };
    if (health.movementProtocol !== MOVEMENT_PROTOCOL) throw new Error('Game server version differs from this page. Restart the server and refresh.');
    devScaleEnabled = health.devScaleEnabled === true;
    const token = sessionStorage.getItem('pcb-reconnection-token');
    const options = { name, private: mode === 'create', protocol: MOVEMENT_PROTOCOL, ...(mode === 'practice' ? { mapId: selectedPracticeMap } : {}) };
    room = mode === 'practice' ? await client.create<MatchState>('practice', options) : mode === 'reconnect' && token ? await client.reconnect<MatchState>(token) : mode === 'join' ? await client.joinById<MatchState>(code, options) : mode === 'create' ? await client.create<MatchState>('pcb', options) : await client.joinOrCreate<MatchState>('pcb', options);
    if (!room.state?.players?.has(room.sessionId)) await new Promise<void>(resolve => room!.onStateChange.once(() => resolve()));
    const me = room.state?.players?.get(room.sessionId);
    pending = []; lastSentInput = null; nextInputAt = performance.now(); seq = me?.ack ?? 0; yaw = me?.yaw ?? 0; pitch = me?.pitch ?? 0;
    const response = await fetch(`/api/map?mapId=${encodeURIComponent(room.state.mapId)}`);
    if (!response.ok) throw new Error('Could not load the room map.');
    buildMap(await response.json() as MapData);
    el('kill-feed').replaceChildren();
    el('map-name').textContent = map.title.toUpperCase();
    el('room-label').textContent = `ROOM ${room.roomId} · COPY LINK`;
    el('room-label').style.pointerEvents = 'auto'; el('room-label').style.cursor = 'pointer';
    history.replaceState(null, '', `?room=${room.roomId}`);
    room.onStateChange(syncState);
    room.onMessage('elimination', (msg: { name: string; chain: number }) => showElimination(msg));
    room.onMessage('feed', (msg: { text: string; chain?: number }) => showFeed(msg.text, msg.chain));
    room.onMessage('shot', (msg: { shooter: string; shotId?: number; weapon?: WeaponId; side: BoardSide; from: number[]; to: number[]; hit?: string }) => {
      if (msg.shooter === room?.sessionId) { visualFireAt = performance.now(); visualFireWeapon = msg.weapon ?? 'solder'; }
      if (msg.side === (local.side ?? 'front')) {
        const predicted = msg.shooter === room?.sessionId && msg.shotId !== undefined ? predictedTracers.get(msg.shotId) : undefined;
        if (predicted) {
          // Correct the one locally predicted tracer to the server result.
          predicted.geometry.setFromPoints([new THREE.Vector3(...msg.from), new THREE.Vector3(...msg.to)]);
          predictedTracers.delete(msg.shotId!);
        } else if (msg.weapon !== 'air') addTracer(msg.from, msg.to, msg.weapon === 'iron' ? '#a9b8ff' : msg.weapon === 'pump' ? '#ffb347' : undefined);
        if (msg.weapon !== 'air') addImpactSparks(msg.from, msg.to);
      }
    });
    room.onMessage('damage', (msg: DamageFeedback) => {
      if (msg.target === room?.sessionId) flashDamage();
      if (!room || msg.shooter !== room.sessionId) return;
      flashHit(msg.eliminated);
      const now = performance.now();
      if (mergeDamageNumber(damageNumbers, msg, now)) return;
      const element = document.createElement('div'); element.className = 'floating-damage';
      document.body.append(element); damageNumbers.push({ ...msg, element, roomId: room.roomId, born: now, updated: now });
      if (damageNumbers.length > 6) damageNumbers.shift()!.element.remove();
    });
    room.onMessage('pickup', (msg: { player: string; amount: number; weapon: WeaponId }) => { if (msg.player === room?.sessionId && validWeaponId(msg.weapon)) { showFeed(`+${msg.amount} ${WEAPONS[msg.weapon].name} Ammo`); sound(710, .16, 'sine'); } });
    room.onDrop(() => { recordMovement('drop', me?.ack ?? 0); mouseDown = false; pending = []; lastSentInput = null; showFeed('Connection lost · reconnecting'); });
    room.onReconnect(() => { const ack = room!.state.players.get(room!.sessionId)?.ack ?? seq; recordMovement('reconnect', ack); pending = []; lastSentInput = null; seq = ack; serverClockOffsetMs = NaN; sessionStorage.setItem('pcb-reconnection-token', room!.reconnectionToken); syncState(room!.state); showFeed('Connection restored'); });
    const joinedRoom = room;
    room.onLeave(() => { if (room !== joinedRoom) return; toggleMaps(false); mapsButton.hidden = true; clearSessionVisuals(); clearElimination(); sessionStorage.removeItem('pcb-reconnection-token'); room = null; scalePanel.hidden = true; el('menu').classList.remove('hidden'); el('hud').classList.add('hidden'); document.exitPointerLock(); showFeed('Disconnected from room'); });
    sessionStorage.setItem('pcb-reconnection-token', room.reconnectionToken);
    if (room.state?.players) syncState(room.state);
    clearElimination();
    visualSide = local.side ?? 'front'; boardFlip = null; renderedHeading = local.headingOffset ?? 0;
    toggleMaps(false); mapsButton.hidden = !room.state.practice;
    for (const button of Array.from(el('map-options').querySelectorAll('button'))) button.setAttribute('aria-pressed', String(button.dataset.mapId === map.id));
    el('menu').classList.add('hidden'); el('hud').classList.remove('hidden');
    if (devScaleEnabled) showFeed('DEV SCALE enabled · press F4 to adjust height');
    if (mode === 'reconnect') el('pause').classList.remove('hidden'); else void canvas.requestPointerLock();
  } catch (error) { if (mode === 'reconnect') sessionStorage.removeItem('pcb-reconnection-token'); el('error').textContent = error instanceof Error ? error.message : String(error); }
}
el('play').onclick = () => connect('play'); el('create').onclick = () => connect('create'); el('join').onclick = () => connect('join');
practiceButton.onclick = () => { selectedPracticeMap = 'bms'; void connect('practice'); };
document.addEventListener('keydown', e => {
  if (!room?.state.practice || e.repeat) return;
  if (e.code === 'KeyM') { e.preventDefault(); toggleMaps(mapsSidebar.hidden); }
  if (e.code === 'Escape' && !mapsSidebar.hidden) toggleMaps(false);
  if (e.code === 'F5') { e.preventDefault(); showNpcHitboxes = !showNpcHitboxes; showFeed(`NPC HITBOXES ${showNpcHitboxes ? 'ON' : 'OFF'}`); }
  if (e.code === 'F6') { e.preventDefault(); room.send('practice:movement'); }
});
el('leave').onclick = () => { sessionStorage.removeItem('pcb-reconnection-token'); room?.leave(); };
el('room-label').onclick = () => { if (!room) return; navigator.clipboard.writeText(location.href).then(() => showFeed('Invite link copied')); };
el('controls-toggle').onclick = () => { el('menu-detail').classList.remove('hidden'); el('menu-detail').innerHTML = 'WASD move · Mouse aim · Click shoot · Space jump · Shift sprint · R reload · Tab scoreboard · Esc pause'; };
el('settings-toggle').onclick = () => {
  el('menu-detail').classList.remove('hidden');
  el('menu-detail').innerHTML = `<label for="sensitivity">MOUSE SENSITIVITY</label><input id="sensitivity" type="range" min=".0008" max=".005" step=".0001" value="${sensitivity}"><label for="volume">SOUND VOLUME</label><input id="volume" type="range" min="0" max="1" step=".05" value="${volume}"><label for="quality">GRAPHICS QUALITY</label><select id="quality"><option value="low">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select>`;
  el<HTMLInputElement>('sensitivity').oninput = e => { sensitivity = Number((e.target as HTMLInputElement).value); localStorage.setItem('pcb-sensitivity', String(sensitivity)); };
  el<HTMLInputElement>('volume').oninput = e => { volume = Number((e.target as HTMLInputElement).value); localStorage.setItem('pcb-volume', String(volume)); };
  el<HTMLSelectElement>('quality').value = quality;
  el<HTMLSelectElement>('quality').onchange = e => { quality = (e.target as HTMLSelectElement).value; localStorage.setItem('pcb-quality', quality); applyQuality(); };
};
const invite = new URLSearchParams(location.search).get('room'); if (invite) el<HTMLInputElement>('code').value = invite.toUpperCase();
if (sessionStorage.getItem('pcb-reconnection-token')) void connect('reconnect');
document.addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'F3') { e.preventDefault(); showDebug = !showDebug; debug.hidden = !showDebug; fpsFrames = 0; fpsStart = performance.now(); } if (e.code === 'F4' && devScaleEnabled && room && !e.repeat) { e.preventDefault(); scalePanel.hidden = !scalePanel.hidden; if (!scalePanel.hidden && document.pointerLockElement === canvas) document.exitPointerLock(); } if (e.code === 'Tab') { e.preventDefault(); el('scoreboard').classList.remove('hidden'); } if (e.code === 'KeyR' && room && !e.repeat) room.send('reload'); });
document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') el('scoreboard').classList.add('hidden'); });
document.addEventListener('mousemove', e => { if (document.pointerLockElement !== canvas) return; yaw -= e.movementX * sensitivity; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * sensitivity)); });
let adsHeld = false, adsZoom = 0, adsSent = false;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => { if (e.button === 2 && currentWeapon().id === 'sniper' && document.pointerLockElement === canvas) { adsHeld = true; room?.send('weapon:ads', true); adsSent = true; } if (e.button === 0) { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); mouseDown = true; } });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || currentWeapon().id !== 'sniper') return;
  mouseDown = false;
  const p = room?.state.players?.get(room.sessionId);
  if (!p?.alive || p.reloading || !p.ammo || p.transitionCooldown > 0 || boardFlip || document.pointerLockElement !== canvas) return;
  room!.send('shoot', weaponShot());
});
document.addEventListener('mouseup', e => {
  if (e.button === 2) { adsHeld = false; return; }
  mouseDown = false;
  if (specialHeld && currentWeapon().id === 'iron') { room?.send('weapon:trigger', { action: 'release', shot: weaponShot() }); specialHeld = false; fullChargeCue = false; gunView.position.z = -.15; sound(130, .12); }
  else cancelSpecial();
});
document.addEventListener('pointerlockchange', () => { el('pause').classList.toggle('hidden', !room || !mapsSidebar.hidden || document.pointerLockElement === canvas); keys.clear(); mouseDown = false; });
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });
window.addEventListener('blur', cancelSpecial);
document.addEventListener('visibilitychange', () => { if (document.hidden) { mouseDown = false; cancelSpecial(); } });
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) cancelSpecial(); });
document.addEventListener('keydown', e => {
  if (!room || e.repeat) return;
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (slot >= 0 && room.state.practice) { e.preventDefault(); mouseDown = false; cancelSpecial(); room.send('weapon:select', WEAPON_IDS[slot]); }
  if (!room.state.practice && e.code === 'KeyQ') { e.preventDefault(); mouseDown = false; cancelSpecial(); room.send('weapon:swap'); }
  if (!room.state.practice && e.code === 'KeyE' && nearbyWeapon) { e.preventDefault(); mouseDown = false; cancelSpecial(); room.send('weapon:collect', nearbyWeapon); }
  if (e.code === 'KeyR') { mouseDown = false; cancelSpecial(); }
});
// Hold leases and aim updates are independent of rendering FPS.
setInterval(() => {
  const p = room?.state.players?.get(room.sessionId);
  if (!room || !p?.alive || p.reloading || p.transitionCooldown > 0 || document.pointerLockElement !== canvas || !mouseDown) { if (specialHeld) cancelSpecial(); return; }
  if (p.weapon !== 'iron' && p.weapon !== 'air') return;
  room.send('weapon:trigger', { action: p.triggerHeld ? 'aim' : 'start', shot: weaponShot() }); specialHeld = true;
}, 100);
el('pause').onclick = e => { if (mapsSidebar.hidden && (e.target as HTMLElement).id !== 'leave') canvas.requestPointerLock(); };

let previous = performance.now();
setInterval(() => {
  if (!room || !snapshot || room.reconnection.isReconnecting) return;
  const me = snapshot.players.get(room.sessionId);
  if (!me?.alive) return;
  const sampledAt = performance.now();
  if (sampledAt < nextInputAt) return;
  nextInputAt = Math.max(nextInputAt + TICK * 1000, sampledAt);
  const locked = document.pointerLockElement === canvas;
  const testing = testMove && testMove.remaining > 0;
  const soakPhase = Math.floor(soakTick / 72) % 4;
  const input: Input = { seq: seq + 1,
    forward: testing ? 1 : soakMode ? [1, 0, -1, 0][soakPhase] : locked ? Number(keys.has('KeyW')) - Number(keys.has('KeyS')) : 0,
    strafe: testing ? 0 : soakMode ? [0, 1, 0, -1][soakPhase] : locked ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0,
    yaw: testing ? testMove!.yaw : yaw, pitch, jump: soakMode ? soakTick % 72 < 10 : !testing && locked && keys.has('Space'),
    sprint: soakMode || (!testing && locked && (keys.has('ShiftLeft') || keys.has('ShiftRight'))) };
  if (soakMode) soakTick++;
  if (testing && --testMove!.remaining === 0) testMove = null;
  const repeatedIdle = (local.flipCooldown ?? 0) === 0 && local.grounded && local.mantleTarget === 0 && (local.transitionCooldown ?? 0) === 0 && input.forward === 0 && input.strafe === 0 && !input.jump && !input.sprint && lastSentInput
    && lastSentInput.forward === 0 && lastSentInput.strafe === 0 && !lastSentInput.jump && !lastSentInput.sprint
    && lastSentInput.yaw === input.yaw && lastSentInput.pitch === input.pitch;
  if (repeatedIdle) return;
  seq++; lastSentInput = input;
  const stats = { collisionChecks: 0 };
  local = stepMotion(local, input, map, TICK, stats, playerTuning); collisionChecks += stats.collisionChecks;
  pending.push(input); if (pending.length > 2048) pending.shift();
  maxPending = Math.max(maxPending, pending.length);
  room.send('input', input);
  recordMovement('input', me.ack, 0, input.forward);
}, 1000 / 60);
function frame(now: number) {
  requestAnimationFrame(frame);
  const elapsedMs = now - previous, dt = Math.min(elapsedMs / 1000, .25); previous = now;
  lastFrameTime = elapsedMs; fpsFrames++;
  frameTimes.push(elapsedMs); if (frameTimes.length > 2400) frameTimes.splice(0, 1200);
  if (room && snapshot) {
    const me = snapshot.players.get(room.sessionId);
    const config = currentWeapon();
    if (mouseDown && config.mode !== 'charge' && config.mode !== 'heat' && document.pointerLockElement === canvas && me?.alive && !me.reloading && (Date.now() - (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0)) / 1000 >= me.weaponReadyAt && (local.transitionCooldown ?? 0) === 0 && !boardFlip && me.ammo > 0 && now - lastShot >= config.fireInterval * 1000) {
      const shotId = ++nextShotId;
      const shot: ShotInput = { shotId, seq, yaw, pitch, viewTime: lastViewTime || undefined };
      room.send('shoot', shot); if (config.id === 'sniper') mouseDown = false; lastShot = now; gunView.position.z = config.id === 'pump' ? -.2 : -.09; gunView.rotation.x = config.id === 'pump' ? .25 : .09; muzzle.visible = true; sound(config.id === 'pump' ? 100 : 235, .07);
      const ray = aimRay(local.x, local.y, local.z, movementYaw(yaw, local), pitch, playerTuning);
      // Immediate full-length preview, without invented impact sparks. The
      // authoritative response reuses and corrects this same tracer.
      if (config.id === 'solder') {
        const predicted = hitscan(ray, map, [], room.sessionId, playerTuning, local.side ?? 'front');
        predictedTracers.set(shotId, addTracer(ray.origin, ray.origin.map((value, i) => value + ray.direction[i] * predicted.distance)));
      }
    }
    const side = local.side ?? 'front';
    if (!me?.alive) boardFlip = null;
    if (side !== visualSide) {
      if (map.back?.enabled && me?.alive && (local.transitionCooldown ?? 0) > 0 && !boardFlip) {
        // Heading changes only at X edges. Use the actual crossed edge, including corners.
        const xEdge = Math.abs((local.headingOffset ?? 0) - renderedHeading) > 1;
        const boundary = nearestFlipEdge(map, camera.position.x, camera.position.z, visualSide);
        boardFlip = { orbit: new EdgeOrbit(camera.position, map, playerTuning.height, xEdge, boundary && boundary.distance < 3 ? boundary : undefined), started: now,
          sourceHeading: renderedHeading, progress: 0 };
      } else boardFlip = null; // Respawn/reconnect is not an edge crossing.
      visualSide = side;
    }
    camera.position.set(local.x, local.y + playerTuning.eye, local.z);
    canvas.dataset.position = `${local.x.toFixed(2)},${local.y.toFixed(2)},${local.z.toFixed(2)}`;
    camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, movementYaw(yaw, local), 0);
    const back = side === 'back' && map.back?.enabled;
    world.rotation.x = back ? Math.PI : 0; world.position.y = back ? -map.back!.thickness : 0;
    if (boardFlip) {
      // Render time, not 60 Hz input acknowledgements, drives the smooth camera path.
      const t = Math.min(1, (now - boardFlip.started) / (EDGE_FLIP_SECONDS * 1000));
      boardFlip.progress = t;
      orbitTarget.copy(camera.position);
      orbitLook.setFromEuler(orbitEuler.set(pitch, yaw + boardFlip.sourceHeading, 0));
      boardFlip.orbit.sample(t, orbitTarget, orbitLook, camera.position, camera.quaternion);
      if (t >= 1) boardFlip = null;
    }
    renderedHeading = local.headingOffset ?? 0;
    gunView.visible = true;
    canvas.dataset.side = side;
    el('side-label').textContent = side.toUpperCase();
    const cooldown = Math.max(0, local.flipCooldown ?? 0);
    el('flip-cooldown').hidden = !map.back?.enabled;
    el('flip-cooldown-label').textContent = cooldown > 0 ? `FLIP - ${cooldown.toFixed(1)}s` : 'FLIP READY';
    el('flip-cooldown-fill').style.width = `${100 * (1 - cooldown / FLIP_COOLDOWN_SECONDS)}%`;
    el('flip-cooldown-meter').setAttribute('aria-valuenow', String(Math.round(100 * (1 - cooldown / FLIP_COOLDOWN_SECONDS))));
    el('flip-cooldown-meter').setAttribute('aria-valuetext', cooldown > 0 ? `${cooldown.toFixed(1)} seconds until flip ready` : 'Flip ready');
    // Prediction may switch surfaces before the next snapshot arrives.
    for (const [id, entry] of remotes) {
      const visible = !boardFlip && snapshot.players.get(id)?.side === side;
      entry.mesh.visible = visible; entry.healthBar.visible = visible;
    }
    for (const [id, mesh] of spoolMeshes) { const pickup = snapshot.pickups.get(id); mesh.visible = !boardFlip && !!pickup?.active && pickup.side === side; }
    gunView.position.z += (0 - gunView.position.z) * Math.min(1, dt * 16);
    gunView.rotation.x += ((me?.reloading ? -.65 : 0) - gunView.rotation.x) * Math.min(1, dt * 12);
    if (now - lastShot > 45) muzzle.visible = false;
  } else {
    const t = now * .00015; camera.position.set(Math.sin(t) * 30, 24, Math.cos(t) * 30); camera.lookAt(0, 0, 0);
  }
  const renderTime = Number.isFinite(serverClockOffsetMs) ? Date.now() - serverClockOffsetMs - COMBAT.interpolationMs : 0;
  if (renderTime > 0) lastViewTime = renderTime;
  for (const entry of remotes.values()) {
    const rendered = samplePosition(entry.samples, renderTime, COMBAT.extrapolationMs);
    if (rendered) entry.mesh.position.set(rendered.x, rendered.y, rendered.z);
    entry.mesh.rotation.y += Math.atan2(Math.sin(entry.yaw - entry.mesh.rotation.y), Math.cos(entry.yaw - entry.mesh.rotation.y)) * Math.min(1, dt * 12);
    entry.displayedHp = THREE.MathUtils.damp(entry.displayedHp, entry.hp, 18, dt);
    const fraction = THREE.MathUtils.clamp(entry.displayedHp / 100, 0, 1);
    entry.healthFill.scale.x = Math.max(.001, fraction);
    entry.healthFill.position.x = -.48 * (1 - fraction);
    entry.healthFill.material.color.setHSL(fraction * .34, .85, .48);
    entry.healthBar.position.set(entry.mesh.position.x, entry.mesh.position.y + playerTuning.height + .3, entry.mesh.position.z);
    entry.healthBar.quaternion.copy(camera.quaternion);
  }
  for (const [id, helper] of npcHitboxes) if (!room?.state.practice || !remotes.has(id)) { scene.remove(helper); helper.dispose(); npcHitboxes.delete(id); }
  if (room?.state.players?.get(room.sessionId)) {
    if (room.state.practice) {
      el('timer').textContent = 'PRACTICE';
      el('player-count').textContent = `5 NPC TARGETS · F5 HITBOXES · F6 ${room.state.npcMovement ? 'FREEZE' : 'RESUME'}`;
    }
    const p = room.state.players.get(room.sessionId)!;
    const config = currentWeapon();
    airCone.visible = p.weapon === 'air' && specialHeld && p.triggerHeld && !p.overheated && !boardFlip;
    airCone.material.opacity = .10 + Math.sin(now * .025) * .025;
    const charge = p.chargeStarted ? Math.min(1, Math.max(0, ((Date.now() - (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0)) / 1000 - p.chargeStarted) / CHARGE.full)) : 0;
    if (specialHeld && charge >= 1 && !fullChargeCue) { fullChargeCue = true; sound(1100, .18, 'sine'); }
    if (!charge) fullChargeCue = false;
    const recharge = p.sniperReloadAt ? Math.max(0, Math.min(1, 1 - (p.sniperReloadAt - (Date.now() - (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0)) / 1000) / 2.5)) : 1;
    weaponMeter.hidden = p.weapon !== 'iron' && p.weapon !== 'air' && p.weapon !== 'sniper'; weaponMeter.value = p.weapon === 'sniper' ? recharge : p.weapon === 'iron' ? charge : p.heat;
    weaponMeter.style.accentColor = p.overheated && p.weapon === 'air' ? '#ff544a' : charge >= 1 ? '#88dfff' : '#ffd24a';
    el('bottom-hud').querySelector('.ammo small')!.textContent = config.name.toUpperCase();
    el('ammo').textContent = config.id === 'air' ? `${Math.round(p.heat * 100)}%` : String(p.ammo);
    el('reserve').textContent = config.id === 'air' ? 'HEAT' : String(p.reserve);
    el('ammo-bar').style.width = `${100 * (config.id === 'air' ? p.heat : p.ammo / config.magazine)}%`;
    weaponStatus.textContent = `SANDBOX · 1 BLASTER · 2 IRON · 3 HOT AIR · 4 PUMP\n${p.reloading ? 'RELOADING' : p.overheated && p.weapon === 'air' ? 'OVERHEATED — COOLING' : p.weapon === 'iron' ? `CHARGE ${Math.round(charge * 100)}% ${charge >= 1 ? 'READY' : '(hold / release)'}` : p.weapon === 'air' ? `HEAT ${Math.round(p.heat * 100)}%` : ''}`;
    weaponStatus.style.whiteSpace = 'pre-line';
    if (room.state.practice) weaponStatus.textContent += '\n5 CAPACITOR SNIPER';
    const viewScale = .75 * playerTuning.height / 1.8;
    gunView.scale.setScalar(viewScale);
    if (!room.state.practice) weaponStatus.textContent = `Q SWAP · E COLLECT\nPRIMARY: BLASTER · SPECIAL: ${p.specialWeapon ? WEAPONS[p.specialWeapon as WeaponId].name.toUpperCase() : 'NONE'}\n${p.reloading ? 'RELOADING' : config.id === 'iron' ? `CHARGE ${Math.round(charge * 100)}%` : config.id === 'air' && p.overheated ? 'OVERHEATED' : ''}`;
    if (p.weapon === 'sniper') weaponStatus.textContent += `\n${p.reloading ? `RECHARGING ${Math.round(recharge * 100)}%` : 'READY · RIGHT CLICK ADS'} · ${p.ammo}/1`;
    if (room.state.practice) for (const [id, entry] of remotes) {
      if (!room.state.players.get(id)?.npc) continue;
      let helper = npcHitboxes.get(id);
      if (!helper) { helper = new THREE.Box3Helper(new THREE.Box3(), 0x00ffff); scene.add(helper); npcHitboxes.set(id, helper); }
      const radius = playerTuning.radius * COMBAT.hitRadiusScale;
      helper.box.setFromCenterAndSize(entry.mesh.position.clone().add(new THREE.Vector3(0, playerTuning.height / 2, 0)), new THREE.Vector3(radius * 2, playerTuning.height * COMBAT.hitHeightScale, radius * 2));
      helper.visible = showNpcHitboxes && entry.mesh.visible;
    }
  }
  const me = room?.state.players?.get(room.sessionId), equipped = currentWeapon().id;
  if (!me?.alive || me.reloading || equipped !== 'sniper' || document.pointerLockElement !== canvas || boardFlip) adsHeld = false;
  if (adsHeld !== adsSent && room) { room.send('weapon:ads', adsHeld); adsSent = adsHeld; }
  adsZoom = adsHeld ? Math.min(1, adsZoom + dt / .15) : Math.max(0, adsZoom - dt / .15);
  camera.fov = 2 * Math.atan(Math.tan(78 * Math.PI / 360) / (1 + .75 * adsZoom)) * 180 / Math.PI;
  camera.updateProjectionMatrix();
  el('crosshair').classList.toggle('sniper-ads', adsHeld);
  const animationCharge = me?.chargeStarted ? Math.min(1, Math.max(0, ((Date.now() - (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0)) / 1000 - me.chargeStarted) / CHARGE.full)) : 0;
  for (const [id, model] of weaponModels) animateWeapon(model, { dt, active: id === equipped && !!me?.alive, enabled: !!me?.alive && document.pointerLockElement === canvas && !boardFlip, charge: animationCharge, heat: me?.heat ?? 0, overheated: me?.overheated ?? false, firing: me?.triggerHeld ?? false, reloading: me?.reloading ?? false, moving: keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD'), fireAt: id === visualFireWeapon ? visualFireAt : 0 });
  const sniperModel = weaponModels.get('sniper')!;
  if (equipped === 'sniper') {
    const progress = me?.sniperReloadAt ? Math.max(0, Math.min(1, 1 - (me.sniperReloadAt - (Date.now() - (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0)) / 1000) / 2.5)) : 1;
    sniperModel.chamber.emissiveIntensity = .05 + progress * 3;
    for (const coil of sniperModel.coils) coil.material.emissiveIntensity = .05 + progress * Math.sin(now * .025) ** 8 * 3 + sniperModel.kick * 8;
    sniperModel.flash.scale.set(1, 1, 4);
    sniperModel.plunger.scale.y = Math.max(.01, progress);
    sniperModel.root.position.x -= adsZoom * .12;
    sniperModel.root.position.y += adsZoom * .08;
  }
  nearbyWeapon = null; pickupPrompt.textContent = '';
  const presentWeaponPickups = new Set<string>(); let nearest: number = WEAPON_PICKUPS.radius;
  room?.state.weaponPickups?.forEach((pickup, id) => {
    presentWeaponPickups.add(id);
    let mesh = weaponPickupModels.get(id);
    if (!mesh) {
      mesh = new THREE.Group(); const miniature = createWeaponModel(pickup.weapon as WeaponId); miniature.root.scale.setScalar(.65); mesh.add(miniature.root); mesh.userData.weaponModel = miniature;
      const glow = new THREE.Mesh(new THREE.CircleGeometry(.55, 16), new THREE.MeshBasicMaterial({ color: pickup.weapon === 'iron' ? '#9b62ff' : pickup.weapon === 'air' ? '#ff6824' : '#e7ad2b', transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })); glow.rotation.x = -Math.PI / 2; glow.position.y = -.35; mesh.add(glow);
      scene.add(mesh); weaponPickupModels.set(id, mesh);
    }
    mesh.visible = pickup.active && pickup.side === (local.side ?? 'front') && !boardFlip;
    mesh.position.set(pickup.x, pickup.y + .7 + Math.sin(now * .002) * .08, pickup.z); mesh.rotation.y = now * .0006;
    const distance = Math.hypot(local.x - pickup.x, local.z - pickup.z);
    if (mesh.visible && me?.alive && distance <= nearest && Math.abs(local.y - pickup.y) <= .75) { nearest = distance; nearbyWeapon = { id, version: pickup.version }; pickupPrompt.textContent = `${WEAPONS[pickup.weapon as WeaponId].name.toUpperCase()} — PRESS E TO PICK UP`; }
  });
  for (const [id, mesh] of weaponPickupModels) if (!presentWeaponPickups.has(id)) { scene.remove(mesh); disposeWeaponModel(mesh.userData.weaponModel); mesh.traverse(object => { if (object instanceof THREE.Mesh && object.geometry.type === 'CircleGeometry') { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } }); weaponPickupModels.delete(id); }
  heatParticles.visible = airCone.visible;
  if (heatParticles.visible) {
    for (let i = 0; i < 24; i++) {
      const t = (now * .0015 + i / 24) % 1, distance = t * WEAPONS.air.range;
      const radius = Math.tan(HEAT.halfAngle) * distance * (.3 + (i % 5) / 7), angle = i * 2.39996;
      heatPositions[i * 3] = Math.cos(angle) * radius; heatPositions[i * 3 + 1] = Math.sin(angle) * radius; heatPositions[i * 3 + 2] = -distance;
    }
    heatGeometry.attributes.position.needsUpdate = true;
    heatGeometry.computeBoundingSphere();
  }
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const number = damageNumbers[i], age = (now - number.born) / 1000;
    if (age > 1 || !room || number.roomId !== room.roomId) { number.element.remove(); damageNumbers.splice(i, 1); continue; }
    const target = room.state.players.get(number.target), remote = remotes.get(number.target);
    if (target?.alive && target.side === number.side) { const pos = remote?.mesh.position ?? target; number.x = pos.x; number.y = pos.y; number.z = pos.z; }
    const head: [number, number, number] = [number.x, number.y + playerTuning.height, number.z];
    const projected = new THREE.Vector3(...head).add(new THREE.Vector3(0, age, 0)).project(camera);
    number.element.textContent = `-${Number(number.amount.toFixed(1))}`;
    number.element.classList.toggle('elimination-damage', number.eliminated);
    number.element.style.display = boardFlip || target?.side !== number.side || projected.z > 1 || projected.z < -1 || !damageNumberVisible(map, local.side ?? 'front', number.side, [camera.position.x, camera.position.y, camera.position.z], head) ? 'none' : '';
    number.element.style.transform = `translate(${(projected.x + 1) * innerWidth / 2}px,${(1 - projected.y) * innerHeight / 2}px)`;
    number.element.style.opacity = String(1 - age);
  }
  for (let i = shots.length - 1; i >= 0; i--) if (now - shots[i].born > 120) {
    for (const [id, predicted] of predictedTracers) if (predicted === shots[i].line) predictedTracers.delete(id);
    scene.remove(shots[i].line); shots[i].line.geometry.dispose(); (shots[i].line.material as THREE.Material).dispose(); shots.splice(i, 1);
  }
  const width = innerWidth, height = innerHeight;
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) { renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  const renderStart = performance.now(); renderer.render(scene, camera); renderCpuMs = performance.now() - renderStart;
  if (showDebug && now - fpsStart >= 500) {
    debug.textContent = `FPS ${(fpsFrames * 1000 / (now - fpsStart)).toFixed(0)}\nFrame ${lastFrameTime.toFixed(1)} ms\nRender CPU ${renderCpuMs.toFixed(1)} ms\nPing ${ping.toFixed(0)} ms\nCorrection ${correction.toFixed(3)} mm\nPlayer height ${playerTuning.height.toFixed(2)} mm\nJump apex ${(playerTuning.height * JUMP_HEIGHT_RATIO).toFixed(2)} mm\nCollision checks ${collisionChecks}\nPending inputs ${pending.length}\nCache queries ${collisionCacheStats(map).queries}\nGeometries ${renderer.info.memory.geometries} · Textures ${renderer.info.memory.textures}\nDraw calls ${renderer.info.render.calls}\nTriangles ${renderer.info.render.triangles}`;
    fpsFrames = 0; fpsStart = now; collisionChecks = 0;
  }
}
setInterval(() => room?.ping(ms => { ping = ms; }), 2000);
el('bottom-hud').querySelector('.ammo small')!.textContent = 'SOLDER BLASTER · SOLDER';
requestAnimationFrame(frame);

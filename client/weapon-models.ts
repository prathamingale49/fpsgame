import * as THREE from 'three';
import type { WeaponId } from '../shared/weapons.js';

const materials = {
  body: new THREE.MeshStandardMaterial({ color: '#253137', roughness: .48, metalness: .55 }),
  metal: new THREE.MeshStandardMaterial({ color: '#aab9bd', metalness: .85, roughness: .28 }),
  copper: new THREE.MeshStandardMaterial({ color: '#c97a36', metalness: .7, roughness: .35 }),
  gold: new THREE.MeshStandardMaterial({ color: '#e7ad2b', metalness: .4, roughness: .5 }),
  black: new THREE.MeshStandardMaterial({ color: '#11191d', roughness: .75 }),
};
const geometry = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) { let g = geometry.get(key); if (!g) { g = make(); geometry.set(key, g); } return g; }
function box(w: number, h: number, d: number) { return cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); }
function cylinder(r: number, length: number) { return cached(`c${r},${length}`, () => new THREE.CylinderGeometry(r, r, length, 12)); }
function ring(r: number) { return cached(`r${r}`, () => new THREE.TorusGeometry(r, .018, 6, 16)); }
function glow(color: string) { return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .5, roughness: .3, metalness: .4 }); }
export type WeaponModel = { id: WeaponId; root: THREE.Group; barrel: THREE.Group; coils: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]; chamber: THREE.MeshStandardMaterial; fan: THREE.Group; plunger: THREE.Group; flash: THREE.Mesh; kick: number; time: number; lastFire: number };
export function createWeaponModel(id: WeaponId): WeaponModel {
  const root = new THREE.Group(), barrel = new THREE.Group(), fan = new THREE.Group(), plunger = new THREE.Group();
  root.name = `weapon-${id}`; root.add(barrel, fan, plunger);
  const chamber = glow(id === 'iron' ? '#8d4dff' : id === 'air' ? '#ff6824' : '#ffcb49');
  const coils: WeaponModel['coils'] = [];
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const tube = (r: number, l: number, z: number, mat: THREE.Material, parent: THREE.Object3D = root) => { const m = mesh(cylinder(r, l), mat, 0, 0, z, parent); m.rotation.x = Math.PI / 2; return m; };
  if (id === 'solder') {
    mesh(box(.32, .3, .42), materials.body, 0, 0, 0);
    const grip = mesh(box(.15, .4, .18), materials.black, 0, -.27, .1); grip.rotation.x = -.22;
    mesh(box(.34, .075, .3), materials.gold, 0, .18, -.03);
    tube(.075, .34, -.36, materials.metal, barrel); tube(.045, .09, -.56, chamber, barrel);
    for (const x of [-.17, .17]) mesh(box(.02, .09, .15), materials.copper, x, 0, -.02);
    const guard = mesh(ring(.11), materials.copper, 0, -.15, -.1); guard.scale.set(1, 1.2, 1);
  } else if (id === 'iron') {
    tube(.09, .48, .12, materials.black); tube(.052, 1.05, -.55, materials.metal, barrel);
    tube(.025, .25, -1.2, materials.copper, barrel);
    tube(.12, .2, -.12, chamber);
    for (let i = 0; i < 6; i++) {
      const coil = mesh(ring(.085 - i * .004), glow('#9b62ff'), 0, 0, -.28 - i * .125, barrel) as WeaponModel['coils'][number]; coils.push(coil);
    }
    for (const x of [-.095, .095]) mesh(box(.025, .035, .68), materials.body, x, -.035, -.43);
    mesh(box(.09, .12, .08), materials.gold, 0, .12, .21);
  } else if (id === 'air') {
    tube(.19, .5, 0, materials.body); tube(.145, .38, -.39, materials.metal, barrel);
    tube(.115, .07, -.61, chamber, barrel);
    mesh(box(.14, .32, .18), materials.black, 0, -.27, .1);
    for (let i = 0; i < 6; i++) for (const x of [-.18, .18]) mesh(box(.025, .12, .025), materials.black, x, 0, -.2 + i * .07);
    fan.position.z = -.24;
    for (let i = 0; i < 5; i++) { const blade = mesh(box(.04, .27, .02), materials.gold, 0, 0, 0, fan); blade.rotation.z = i * Math.PI / 5; }
    tube(.055, .06, -.28, materials.copper);
  } else {
    tube(.17, .7, 0, materials.gold); tube(.11, .22, -.46, materials.black, barrel);
    tube(.055, .16, -.64, materials.metal, barrel);
    tube(.055, .5, .38, materials.metal, plunger); tube(.2, .09, .68, materials.black, plunger);
    for (let i = 0; i < 9; i++) mesh(ring(.095), materials.metal, 0, 0, .2 + i * .045, plunger);
    mesh(box(.14, .24, .15), materials.black, 0, -.22, -.1);
    for (let i = 0; i < 3; i++) mesh(box(.35, .06, .03), materials.black, 0, 0, -.22 + i * .15);
  }
  const flash = mesh(cached('flash', () => new THREE.IcosahedronGeometry(.12, 0)), new THREE.MeshBasicMaterial({ color: id === 'iron' ? '#c4a4ff' : '#fff0a0', transparent: true, opacity: .9 }), 0, 0, id === 'iron' ? -1.34 : -.72);
  flash.visible = false;
  return { id, root, barrel, coils, chamber, fan, plunger, flash, kick: 0, time: 0, lastFire: 0 };
}
export type WeaponAnimation = { dt: number; active: boolean; enabled: boolean; charge: number; heat: number; overheated: boolean; firing: boolean; reloading: boolean; moving: boolean; fireAt: number };
export function disposeWeaponModel(model: WeaponModel) { model.chamber.dispose(); for (const coil of model.coils) coil.material.dispose(); (model.flash.material as THREE.Material).dispose(); model.root.removeFromParent(); }
export function animateWeapon(model: WeaponModel, input: WeaponAnimation) {
  const { root, barrel, plunger } = model;
  const dt = Math.max(0, Math.min(input.dt, .25)), charge = input.enabled && !input.reloading ? input.charge : 0;
  root.visible = input.active;
  if (!input.active || !input.enabled) { model.kick = 0; model.lastFire = input.fireAt; root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); barrel.position.z = 0; plunger.position.z = 0; model.flash.visible = false; model.chamber.emissiveIntensity = .3; for (const coil of model.coils) coil.material.emissiveIntensity = .2; return; }
  model.time += dt;
  if (input.fireAt > model.lastFire) { model.lastFire = input.fireAt; model.kick = 1; }
  model.kick = THREE.MathUtils.damp(model.kick, 0, 12, dt);
  const sway = Math.sin(model.time * (input.moving ? 10 : 1.8)) * (input.moving ? .018 : .004);
  const tension = model.id === 'iron' ? charge * .34 : 0;
  root.position.z = THREE.MathUtils.damp(root.position.z, tension + model.kick * .16, charge > 0 ? 12 : 35, dt);
  root.position.y = sway - (input.reloading ? .2 : 0);
  root.position.x = charge > .85 ? Math.sin(model.time * 95) * .004 * charge : 0;
  root.rotation.x = model.kick * (model.id === 'pump' ? .2 : .06) + (input.reloading ? -.5 : 0);
  root.rotation.z = sway * .3;
  barrel.position.z = model.id === 'iron' ? charge * .16 : 0;
  plunger.position.z = model.id === 'pump' ? -model.kick * .32 : 0;
  model.fan.rotation.z += dt * (input.firing ? 35 : input.heat * 15);
  model.chamber.emissiveIntensity = model.id === 'iron' ? .3 + charge * 4 : model.id === 'air' ? .3 + input.heat * 3 + (input.overheated ? Math.sin(model.time * 16) ** 2 * 2 : 0) : .4 + model.kick * 3;
  for (let i = 0; i < model.coils.length; i++) model.coils[i].material.emissiveIntensity = charge >= (i + 1) / model.coils.length ? 3 + charge * 2 : .15;
  model.flash.visible = model.kick > .5;
  model.flash.scale.setScalar(model.id === 'pump' ? 1.6 : model.id === 'iron' ? 1 + charge : .8);
}

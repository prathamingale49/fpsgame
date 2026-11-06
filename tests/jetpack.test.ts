import { expect, it } from 'vitest';
import fs from 'node:fs';
import { initialMotion, JETPACK, PLAYER, stepMotion, testMap, TICK, transitionEdge, surfaceMap, type Input, type MapData, type Motion } from '../shared/game.js';
const empty={...testMap,boxes:[],width:500,depth:500};
const idle:Input={seq:1,forward:0,strafe:0,yaw:0,pitch:0,jump:false,sprint:false};
function advance(m:Motion,count:number,input=idle,map:MapData=empty) {for(let i=0;i<count;i++)m=stepMotion(m,input,map);return m;}
it('accelerates while held, caps ascent, and exhausts fuel in 2.5 seconds',()=>{
  const launch=stepMotion(initialMotion([0,0,0]),{...idle,jump:true},empty);
  const next=stepMotion(launch,{...idle,jump:true},empty);
  expect(next.vy).toBeGreaterThan(launch.vy);expect(next.fuel).toBeLessThan(launch.fuel!);
  const spent=advance(initialMotion([0,0,0]),150,{...idle,jump:true});
  expect(spent.y).toBeGreaterThan(30);expect(spent.fuel).toBe(0);expect(spent.boostLocked).toBe(true);
  expect(spent.vy).toBeLessThanOrEqual(PLAYER.sprintSpeed*JETPACK.ascentSprintRatio);
  const falling=advance(spent,120,{...idle,jump:true});expect(falling.boosting).toBe(false);expect(falling.vy).toBeLessThan(0);
});
it('releasing thrust preserves momentum, applies gravity and never recharges in midair',()=>{
  const rising=advance(initialMotion([0,0,0]),30,{...idle,jump:true});
  const released=stepMotion(rising,idle,empty);
  expect(released.boosting).toBe(false);expect(released.vy).toBeCloseTo(rising.vy-PLAYER.gravity*TICK);
  expect(released.vy).toBeGreaterThan(0);expect(released.fuel).toBe(rising.fuel);
  const falling=advance({...released,y:200,vy:0},120);
  expect(falling.fuel).toBe(released.fuel);expect(falling.vy).toBeCloseTo(-PLAYER.sprintSpeed*JETPACK.fallSprintRatio);
});
it('recharges on a real landing in three seconds, with no empty-engine fuel pumping',()=>{
  const landed=stepMotion({...initialMotion([0,.05,0]),grounded:false,vy:-5,fuel:0,boostLocked:true},idle,empty);
  expect(landed.grounded).toBe(true);expect(landed.fuel).toBeGreaterThan(0);
  const charged=advance(landed,179);expect(charged.fuel).toBeCloseTo(1,5);
  const held=advance({...initialMotion([0,0,0]),fuel:0,jumpHeld:true,boostLocked:true},180,{...idle,jump:true});
  expect(held.grounded).toBe(true);expect(held.fuel).toBeCloseTo(1,5);expect(held.boosting).toBe(false);
  const rearmed=stepMotion(held,idle,empty);expect(stepMotion(rearmed,{...idle,jump:true},empty).boosting).toBe(true);
});
it('steers by yaw independently of pitch and limits sprint to the ground',()=>{
  const start={...initialMotion([0,10,0]),grounded:false};
  const flat=stepMotion(start,{...idle,forward:1,strafe:1,sprint:true},empty);
  const up=stepMotion(start,{...idle,forward:1,strafe:1,sprint:true,pitch:1.4},empty);
  expect([flat.x,flat.z]).toEqual([up.x,up.z]);expect(Math.hypot(flat.x,flat.z)).toBeCloseTo(PLAYER.walkSpeed*TICK);
  const turn=stepMotion(start,{...idle,forward:1,yaw:Math.PI/2},empty);expect(turn.x).toBeLessThan(0);expect(Math.abs(turn.z)).toBeLessThan(1e-6);
  const sprint=stepMotion(initialMotion([0,0,0]),{...idle,forward:1,sprint:true},empty);expect(Math.abs(sprint.z)).toBeCloseTo(PLAYER.sprintSpeed*TICK);
});
it('cannot thrust through a ceiling or consume/recharge fuel during a board flip',()=>{
  const ceiling={...empty,boxes:[{min:[-3,3,-3] as [number,number,number],max:[3,4,3] as [number,number,number],climbable:true}]};
  const stopped=advance(initialMotion([0,0,0]),120,{...idle,jump:true},ceiling);
  expect(stopped.y+PLAYER.height).toBeLessThanOrEqual(3+.001);
  const map={...empty,width:100,back:{enabled:true,thickness:1.6,boxes:[]}};
  let flip=transitionEdge({...initialMotion([51,2,0]),fuel:.4,boosting:true},map,PLAYER);
  expect(flip.boosting).toBe(false);
  for(let i=0;i<50;i++)flip=stepMotion(flip,{...idle,jump:true,sprint:true},map);
  expect(flip.fuel).toBe(.4);expect(flip.vy).toBe(0);expect(flip.transitionCooldown).toBeGreaterThan(0);
});
for(const id of ['bms','recovery','flight-sam']) for (const side of ['front','back'] as const) it(`${id} ${side}: reaches and lands on an actual elevated collider`,()=>{
  const map:MapData=JSON.parse(fs.readFileSync(`assets/public/maps/${id}.json`,'utf8'));
  const box=surfaceMap(map,side).boxes.filter(b=>b.max[1]>=1 && b.max[1]<=18 && b.max[0]-b.min[0]>1 && b.max[2]-b.min[2]>1).sort((a,b)=>b.max[1]-a.max[1])[0];
  expect(box).toBeDefined();const x=(box.min[0]+box.max[0])/2,z=(box.min[2]+box.max[2])/2;
  // Start above the real component, boost, and return to its solid top.
  let m:Motion={...initialMotion([x,box.max[1]+1,z]),grounded:false,side};
  m=advance(m,60,{...idle,jump:true},map);expect(m.y).toBeGreaterThan(box.max[1]+5);
  m=advance(m,300,idle,map);expect(m.grounded).toBe(true);expect(m.y).toBeGreaterThanOrEqual(box.max[1]-.01);expect(m.fuel).toBeGreaterThan(.6);
});

it('stops upward flight at the actual PCB underside',()=>{
  const start={...initialMotion([0,-3,0]),grounded:false,vy:10};
  const stopped=advance(start,90,{...idle,jump:true});
  expect(stopped.y+PLAYER.height).toBeLessThanOrEqual(-.45+.001);
});

it('does not recharge on the first unsupported step off a component',()=>{
  const map={...empty,boxes:[{min:[-.1,0,-2] as [number,number,number],max:[.1,2,2] as [number,number,number]}]};
  const next=stepMotion({...initialMotion([.27,2,0]),fuel:.5},{...idle,strafe:1},map);
  expect(next.grounded).toBe(false);expect(next.fuel).toBe(.5);
});

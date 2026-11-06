import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MOVEMENT_PROTOCOL, WEAPON } from '../shared/game.js';
import { ammoPickupAmount, WEAPONS, type WeaponId } from '../shared/weapons.js';
import type { MatchState } from '../server/state.js';
const port=26718, rooms:Room<MatchState>[]=[];
let server:ChildProcess;
const wait=async(fn:()=>boolean,ms=4000)=>{const until=Date.now()+ms;while(!fn() && Date.now()<until) await delay(20);expect(fn()).toBe(true);};
const player=(r:Room<MatchState>)=>r.state.players.get(r.sessionId)!;
beforeAll(async()=>{
  server=spawn(process.execPath,['--import','tsx','tests/fixtures/ammo-server.ts'],{env:{...process.env,PORT:String(port),PCB_TEST_PICKUP_SECONDS:'.5'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(`http://localhost:${port}/api/health`)).ok)return;}catch{}await delay(100);}
  throw new Error('Ammo fixture failed to start');
});
afterAll(async()=>{for(const r of rooms) try{await r.leave();}catch{}server?.kill();});
async function open(kind:string,weapon:WeaponId) {
  const client=new Client(`ws://localhost:${port}`), options={protocol:MOVEMENT_PROTOCOL};
  const room=await client.create<MatchState>(kind,options);rooms.push(room);room.onMessage('*',()=>{});
  await wait(()=>!!room.state.players?.get(room.sessionId));
  if(kind==='pcb') {const peer=await client.joinById<MatchState>(room.roomId,options);rooms.push(peer);peer.onMessage('*',()=>{});await wait(()=>room.state.phase==='playing');}
  if(weapon!=='solder') {
    if(kind==='practice') room.send('weapon:select',weapon);
    else room.send('weapon:collect',{id:weapon,version:room.state.weaponPickups.get(weapon)!.version});
    await wait(()=>player(room).weapon===weapon);
  }
  return room;
}
it('defines the requested starting reserves, caps, grants and unchanged spool timer',()=>{
  expect([WEAPONS.solder.reserve,WEAPONS.iron.reserve,WEAPONS.pump.reserve]).toEqual([60,10,12]);
  expect([WEAPONS.solder.magazine,WEAPONS.iron.magazine,WEAPONS.pump.magazine]).toEqual([30,5,6]);
  expect(WEAPON.pickupRespawnSeconds).toBe(20);
  expect(ammoPickupAmount('solder',100)).toBe(20);expect(ammoPickupAmount('iron',18)).toBe(2);expect(ammoPickupAmount('pump',24)).toBe(0);
});
for(const kind of ['pcb','practice']) for(const weapon of ['solder','iron','pump','air','sniper'] as WeaponId[]) it(`${kind}: ${weapon} collects only its own reserve grant`,async()=>{
  const r=await open(kind,weapon), p=player(r), magazine=p.ammo, reserve=p.reserve;
  const events:{player:string;amount:number;weapon:WeaponId}[]=[];r.onMessage('pickup',event=>events.push(event));
  r.send('test:position',{x:0});
  const grant=WEAPONS[weapon].pickupRounds;
  if(grant) {
    await wait(()=>events.some(event=>event.player===r.sessionId) && p.reserve===reserve+grant && !r.state.pickups.get('ammo')!.active);
    expect(p.reserve).toBe(reserve+grant);expect(p.ammo).toBe(magazine);
    expect(events.filter(event=>event.player===r.sessionId)).toEqual([{player:r.sessionId,weapon,amount:grant}]);
    expect(r.state.pickups.get('ammo')!.active).toBe(false);
    r.send('test:position',{x:5});await wait(()=>r.state.pickups.get('ammo')!.active,1500);
  } else {await delay(150);expect(r.state.pickups.get('ammo')!.active).toBe(true);expect(p.reserve).toBe(reserve);expect(events).toHaveLength(0);}
});
for(const weapon of ['solder','iron','pump'] as WeaponId[]) it(`${weapon}: full reserves leave the spool and partial grants report the actual amount`,async()=>{
  const r=await open('practice',weapon),p=player(r),cap=WEAPONS[weapon].maxReserve;
  const events:{amount:number}[]=[];r.onMessage('pickup',event=>events.push(event));
  r.send('test:position',{x:0,reserve:cap});await delay(120);
  expect(p.reserve).toBe(cap);expect(r.state.pickups.get('ammo')!.active).toBe(true);expect(events).toHaveLength(0);
  r.send('test:position',{reserve:cap-2});await wait(()=>events.length===1 && p.reserve===cap);
  expect(p.reserve).toBe(cap);expect(events[0].amount).toBe(2);expect(p.ammo).toBe(WEAPONS[weapon].magazine);
});
it('preserves side and distance checks, inventory stock, and reconnect without duplicate grants',async()=>{
  const r=await open('practice','iron'),p=player(r);
  await delay(120);expect(p.reserve).toBe(10);expect(r.state.pickups.get('ammo')!.active).toBe(true);
  r.send('test:position',{x:0,spoolSide:'back'});await delay(120);expect(p.reserve).toBe(10);expect(r.state.pickups.get('ammo')!.active).toBe(true);
  r.send('test:position',{side:'back'});await wait(()=>p.reserve===15);
  r.send('test:position',{x:5});
  for(let i=0;i<4;i++){r.send('weapon:select','solder');r.send('weapon:select','iron');}
  await delay(150);expect(p.reserve).toBe(15);
  r.send('weapon:select','solder');await wait(()=>p.weapon==='solder');expect(p.reserve).toBe(60);
  r.send('weapon:select','iron');await wait(()=>p.weapon==='iron');expect(p.reserve).toBe(15);
  let reconnected=false;r.onReconnect(()=>{reconnected=true;});r.reconnection.minUptime=0;r.connection.close(CloseCode.MAY_TRY_RECONNECT);
  await wait(()=>reconnected);expect(player(r).reserve).toBe(15);
});
it('transfers an ammo-enriched dropped weapon once and gives replacement weapons their intended starting stock',async()=>{
  const r=await open('pcb','iron'),p=player(r);
  r.send('test:position',{x:0});await wait(()=>p.reserve===15);r.send('test:position',{x:5});
  r.send('weapon:collect',{id:'air',version:r.state.weaponPickups.get('air')!.version});await wait(()=>p.weapon==='air');
  const drop=[...r.state.weaponPickups.entries()].find(([,pickup])=>pickup.dropped && pickup.weapon==='iron')!;
  expect(drop).toBeDefined();
  const peer=rooms.find(room=>room!==r && room.roomId===r.roomId)!;
  peer.send('weapon:collect',{id:drop[0],version:drop[1].version});peer.send('weapon:collect',{id:drop[0],version:drop[1].version});
  await wait(()=>player(peer).weapon==='iron');expect(player(peer).reserve).toBe(15);expect(player(peer).ammo).toBe(5);
  expect(r.state.weaponPickups.has(drop[0])).toBe(false);
  r.send('weapon:collect',{id:'pump',version:r.state.weaponPickups.get('pump')!.version});await wait(()=>p.weapon==='pump');
  expect(p.reserve).toBe(12);expect(p.ammo).toBe(6);
});

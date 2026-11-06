import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initialMotion, MOVEMENT_PROTOCOL, JETPACK, stepMotion, testMap, type Motion } from '../shared/game.js';
import type { MatchState } from '../server/state.js';
const human=(r:Room<MatchState>)=>r.state.players.get(r.sessionId)!;
const wait=async(fn:()=>boolean,ms=5000)=>{const end=Date.now()+ms;while(!fn() && Date.now()<end)await delay(20);expect(fn()).toBe(true);};
it('synchronizes two flying players, ignores forged fuel, permits combat, and falls when input stops',async()=>{
  const port=26720,server=spawn(process.execPath,['--import','tsx','tests/fixtures/flight-server.ts'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
  const rooms:Room<MatchState>[]=[];
  try {
    for(let i=0;i<100;i++){try{if((await fetch(`http://localhost:${port}/api/health`)).ok)break;}catch{}await delay(100);}
    const client=new Client(`ws://localhost:${port}`),options={protocol:MOVEMENT_PROTOCOL};
    const a=await client.create<MatchState>('pcb',options);rooms.push(a);a.onMessage('*',()=>{});
    const b=await client.joinById<MatchState>(a.roomId,options);rooms.push(b);b.onMessage('*',()=>{});
    await wait(()=>a.state.phase==='playing' && b.state.players?.size===2);
    a.send('dev:flight',{...JETPACK,boostSeconds:12});await delay(100);expect(a.state.flightTuning.boostSeconds).toBe(JETPACK.boostSeconds);
    let predicted:Motion=initialMotion([0,0,0]);
    for(const seq of [1,2]) {
      const input={seq,forward:0,strafe:0,yaw:0,pitch:0,jump:seq===1,sprint:false};
      predicted=stepMotion(predicted,input,{...testMap,boxes:[]});a.send('input',input);b.send('input',input);await delay(17);
    }
    for(let seq=3;seq<=62;seq++) {
      const input={seq,forward:0,strafe:1,yaw:0,pitch:0,jump:true,sprint:false};
      predicted=stepMotion(predicted,input,{...testMap,boxes:[]});
      a.send('input',{...input,fuel:1,boosting:false});b.send('input',{...input,strafe:0});await delay(17);
    }
    await wait(()=>human(a).ack===62 && human(b).ack===62);
    expect(human(a).y).toBeGreaterThan(10);expect(human(b).y).toBeGreaterThan(10);
    expect(human(a).fuel).toBeCloseTo(1-JETPACK.fuelBurnRate/JETPACK.boostSeconds,5);expect(human(a).fuel).toBeCloseTo(predicted.fuel!,5);
    expect(human(a).y).toBeCloseTo(predicted.y,3);expect(human(a).x).toBeCloseTo(predicted.x,3);
    expect(b.state.players.get(a.sessionId)!.boosting).toBe(true);
    const pa=human(a),pb=human(b),yaw=Math.atan2(-(pb.x-pa.x),-(pb.z-pa.z));
    a.send('shoot',{shotId:1,seq:62,yaw,pitch:0});await wait(()=>human(b).hp===75);
    a.send('reload');await wait(()=>human(a).reloading);expect(human(a).grounded).toBe(false);
    a.send('input',{seq:63,forward:0,strafe:0,yaw:0,pitch:0,jump:'refill',sprint:false,fuel:1});
    await delay(60);expect(human(a).ack).toBe(62);expect(human(a).fuel).toBeCloseTo(1-JETPACK.fuelBurnRate/JETPACK.boostSeconds,5);
    await wait(()=>human(a).grounded && !human(a).boosting,6000);
    expect(human(a).ack).toBe(62);expect(human(a).y).toBe(0);
    await wait(()=>human(a).fuel===1,4000);
    expect(human(a).ammo).toBe(30);
    // A separate practice room can select, aim, reload and fire while boosting.
    const practice=await client.create<MatchState>('practice',options);rooms.push(practice);practice.onMessage('*',()=>{});
    await wait(()=>practice.state.players?.size===6);
    let seq=0; const timer=setInterval(()=>practice.send('input',{seq:++seq,forward:0,strafe:0,yaw:0,pitch:0,jump:seq!==2,sprint:false}),17);
    try {
      await wait(()=>human(practice).y>8);
      for(const weapon of ['iron','pump','air','sniper','solder']) {
        practice.send('weapon:select',weapon);await wait(()=>human(practice).weapon===weapon);
        expect(human(practice).grounded).toBe(false);
      }
      practice.send('weapon:select','sniper');await wait(()=>human(practice).weapon==='sniper');
      practice.send('weapon:ads',true);await wait(()=>human(practice).ads);
      practice.send('shoot',{shotId:2,seq:human(practice).ack,yaw:Math.PI,pitch:0});
      await wait(()=>human(practice).reloading);expect(human(practice).grounded).toBe(false);
    } finally {clearInterval(timer);}
  } finally {for(const room of rooms)try{await room.leave();}catch{}server.kill();}
},25000);

it('synchronizes validated demo settings per room without resetting fuel',async()=>{
  const port=26723,server=spawn(process.execPath,['--import','tsx','tests/fixtures/flight-server.ts'],{env:{...process.env,PORT:String(port),PCB_DEV_SCALE:'1'},stdio:'ignore'});
  const rooms:Room<MatchState>[]=[];
  try {
    for(let i=0;i<100;i++){try{if((await fetch(`http://localhost:${port}/api/health`)).ok)break;}catch{}await delay(100);}
    const client=new Client(`ws://localhost:${port}`),options={protocol:MOVEMENT_PROTOCOL};
    const a=await client.create<MatchState>('pcb',options);rooms.push(a);a.onMessage('*',()=>{});
    const b=await client.joinById<MatchState>(a.roomId,options);rooms.push(b);b.onMessage('*',()=>{});
    await wait(()=>b.state.players?.size===2);
    const settings={...JETPACK,boostSeconds:5,rechargeSeconds:2,thrustGravityRatio:2};
    a.send('dev:flight',settings);await wait(()=>b.state.flightTuning.boostSeconds===5);
    expect(b.state.flightTuning.rechargeSeconds).toBe(2);
    a.send('dev:flight',{...settings,boostSeconds:-1});await delay(100);expect(a.state.flightTuning.boostSeconds).toBe(5);
    for(let seq=1;seq<=62;seq++){a.send('input',{seq,forward:0,strafe:0,yaw:0,pitch:0,jump:seq!==2,sprint:false});await delay(17);}
    await wait(()=>human(a).ack===62);expect(human(a).fuel).toBeCloseTo(1-JETPACK.fuelBurnRate/5,4);
    const separate=await client.create<MatchState>('practice',options);rooms.push(separate);separate.onMessage('*',()=>{});
    await wait(()=>separate.state.players?.size===6);expect(separate.state.flightTuning.boostSeconds).toBe(JETPACK.boostSeconds);
  }finally{for(const room of rooms)try{await room.leave();}catch{}server.kill();}
},15000);

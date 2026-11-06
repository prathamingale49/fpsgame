import { chromium } from 'playwright';
import { Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import { MOVEMENT_PROTOCOL } from '../shared/game.js';
import type { MatchState } from '../server/state.js';
const port=26721, fixturePort=26722, base=`http://localhost:${port}`;
const server=spawn(process.execPath,['dist-server/main.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
const fixture=spawn(process.execPath,['--import','tsx','tests/fixtures/flight-server.ts'],{env:{...process.env,PORT:String(fixturePort)},stdio:'ignore'});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let actor: Room<MatchState> | undefined;
try {
  for(const p of [port,fixturePort]) for(let i=0;i<100;i++){try{if((await fetch(`http://localhost:${p}/api/health`)).ok)break;}catch{}await delay(100);}
  const page=await browser.newPage({viewport:{width:1100,height:750}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  fs.mkdirSync('docs/screenshots/jetpack',{recursive:true});
  await page.goto(base);await page.locator('#practice').click();await page.locator('#hud:not(.hidden)').waitFor();
  for(const id of ['bms','recovery','flight-sam']) {
    if(id!=='bms') {await page.keyboard.press('KeyM');await page.locator(`#map-options button[data-map-id="${id}"]`).click();}
    await page.waitForFunction(id=>(window as any).__pcbPerf().mapId===id,id);
    await page.locator('#game[data-model-loaded="true"]').waitFor({timeout:60000});
    await page.locator('#game').click();await page.waitForFunction(()=>document.pointerLockElement?.id==='game');
    await page.mouse.move(550,650);await page.keyboard.down('Space');
    await page.waitForFunction(()=>{const p=(window as any).__pcbPerf();return p.boosting && p.position[1]>2 && p.fuel<.9;});
    await page.mouse.down();await delay(150);await page.mouse.up();
    await page.waitForFunction(()=>Number(document.querySelector('#ammo')?.textContent)<30);
    for(const [key,name] of [['Digit2','PRECISION IRON'],['Digit3','HOT AIR REWORK GUN'],['Digit4','DESOLDERING PUMP'],['Digit5','CAPACITOR SNIPER']]) {
      await page.keyboard.press(key);await page.locator('.ammo small').getByText(name,{exact:true}).waitFor();
    }
    await page.screenshot({path:`docs/screenshots/jetpack/${id}-flight.png`});
    await page.waitForFunction(()=>{const p=(window as any).__pcbPerf();return p.fuel<.001 && !p.boosting;},null,{timeout:5000});
    await page.keyboard.up('Space');
    await page.waitForFunction(()=>(window as any).__pcbPerf().grounded,null,{timeout:7000});
    await page.waitForFunction(()=>(window as any).__pcbPerf().fuel>=.999,null,{timeout:4500});
    const result=await page.evaluate(()=>(window as any).__pcbPerf());
    if(Math.abs(result.fuel-result.authoritativeFuel)>.02) throw new Error(`Fuel prediction drift on ${id}`);
    await page.keyboard.press('Digit1');await page.evaluate(()=>document.exitPointerLock());
  }
  await page.locator('#leave').click();await page.goto(`http://localhost:${fixturePort}`);await page.locator('#create').click();
  await page.locator('#hud:not(.hidden)').waitFor();
  const code=(await page.locator('#room-label').textContent())!.match(/ROOM (\w+)/)![1];
  actor=await new Client(`ws://localhost:${fixturePort}`).joinById<MatchState>(code,{protocol:MOVEMENT_PROTOCOL});actor.onMessage('*',()=>{});
  for(let i=0;i<100 && !actor.state.players?.size;i++)await delay(25);
  for(let seq=1;seq<=24;seq++){actor.send('input',{seq,forward:0,strafe:0,yaw:0,pitch:0,jump:true,sprint:false});await delay(17);}
  await page.waitForFunction(id=>(window as any).__pcbPerf().boostingRemotes.includes(id),actor.sessionId);
  await page.screenshot({path:'docs/screenshots/jetpack/remote-exhaust.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({maps:3,fuelDepletionAndRecharge:true,airborneCombat:true,remoteExhaust:true,errors}));
} finally {await actor?.leave();await browser.close();server.kill();fixture.kill();}

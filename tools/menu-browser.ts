import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
const port=26716, base=`http://localhost:${port}`;
const server=spawn(process.execPath,['dist-server/main.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors:string[]=[];
try {
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok) break;}catch{}await delay(100);}
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  fs.mkdirSync('docs/screenshots/menu',{recursive:true});
  for(const [width,height] of [[1920,1080],[1366,768],[800,600],[375,667],[640,480]]) {
    await page.setViewportSize({width,height});await page.goto(base);
    const play=await page.locator('#play').boundingBox();
    if(!play || play.y<0 || play.y+play.height>height || play.x<0 || play.x+play.width>width) throw new Error(`PLAY NOW outside ${width}x${height}`);
    if(await page.locator('#practice-map').count()) throw new Error('Old map selector');
    if(await page.locator('#maps-toggle').isVisible()) throw new Error('Maps button on landing');
    await page.screenshot({path:`docs/screenshots/menu/landing-${width}.png`});
  }
  await page.setViewportSize({width:1366,height:768});await page.locator('#play').click();
  await page.locator('#hud:not(.hidden)').waitFor();
  await page.waitForFunction(()=>(window as any).__pcbPerf().mapId===(window as any).__pcbPerf().authoritativeMapId);
  await page.locator('#game[data-model-loaded="true"]').waitFor();
  if(await page.locator('#maps-toggle').isVisible()) throw new Error('Maps sidebar available in multiplayer');
  await page.evaluate(()=>document.exitPointerLock());await page.locator('#leave').click();await page.locator('#menu:not(.hidden)').waitFor();
  await page.locator('#create').click();await page.locator('#hud:not(.hidden)').waitFor();
  const code=(await page.locator('#room-label').textContent())!.match(/ROOM (\w+)/)![1];
  const peer=await browser.newPage();peer.on('pageerror',e=>errors.push(e.message));await peer.goto(base);
  await peer.locator('.join-details summary').click();await peer.locator('#code').fill(code);await peer.locator('#join').click();
  await peer.waitForFunction(()=>document.querySelector('#player-count')?.textContent?.includes('2 / 8'));
  const a=await page.evaluate(()=>(window as any).__pcbPerf().mapId),b=await peer.evaluate(()=>(window as any).__pcbPerf().mapId);
  if(a!==b) throw new Error('Private room join map mismatch');
  await peer.evaluate(()=>document.exitPointerLock());await peer.locator('#leave').click();await peer.close();
  await page.evaluate(()=>document.exitPointerLock());await page.locator('#leave').click();await page.locator('#menu:not(.hidden)').waitFor();
  await page.locator('#practice').click();await page.locator('#hud:not(.hidden)').waitFor();await page.evaluate(()=>document.exitPointerLock());
  await page.keyboard.press('KeyM');await page.locator('#maps-sidebar:not([hidden])').waitFor();
  await page.screenshot({path:'docs/screenshots/menu/practice-sidebar.png'});
  await page.locator('#maps-close').click();if(await page.locator('#maps-sidebar').isVisible()) throw new Error('Sidebar did not close');
  if(errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({responsive:true,playNow:true,privateRoomJoin:true,matchingMaps:true,sidebar:true,errors}));
} finally {await browser.close();server.kill();}

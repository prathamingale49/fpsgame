import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
const port = 26696, base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl'] });
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await delay(100); }
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.addInitScript(() => localStorage.setItem('pcb-quality', 'low'));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const resources = new Map<string, { objects: number; geometries: number; materials: number; textures: number }>();
  await page.goto(base);
  if (await page.locator('#practice-map').count()) throw new Error('Landing page map selector remains');
  await page.locator('#practice').click();
  await page.locator('#hud:not(.hidden)').waitFor();
  await page.waitForFunction(() => (window as any).__pcbPerf().authoritativeMapId === 'bms');
  for (const mapId of ['bms', 'recovery', 'flight-sam', 'bms', 'recovery', 'flight-sam', 'bms', 'recovery', 'flight-sam']) {
  if (mapId !== await page.evaluate(() => (window as any).__pcbPerf().mapId)) {
    await page.keyboard.press('KeyM');
    await page.locator(`#map-options button[data-map-id="${mapId}"]`).click();
  }
  await page.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  await page.locator('#maps-sidebar[hidden]').waitFor({ state: 'attached' });
  await page.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('5 NPC TARGETS'));
  await page.waitForFunction(id => (window as any).__pcbPerf().mapId === id && (window as any).__pcbPerf().authoritativeMapId === id, mapId);
  for (const [key, name] of [['Digit1','SOLDER BLASTER'],['Digit2','PRECISION IRON'],['Digit3','HOT AIR REWORK GUN'],['Digit4','DESOLDERING PUMP'],['Digit5','CAPACITOR SNIPER']]) {
    await page.keyboard.press(key); await page.locator('.ammo small').getByText(name, { exact: true }).waitFor(); await delay(150);
  }
  await page.keyboard.press('Digit1');
  await page.locator('.ammo small').getByText('SOLDER BLASTER', { exact: true }).waitFor();
  await page.locator('#game').click();
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game');
  await page.mouse.down(); await delay(180); await page.mouse.up();
  await page.waitForFunction(() => Number(document.querySelector('#ammo')?.textContent) < 30);
  await page.keyboard.press('F5'); await page.locator('#kill-feed').getByText('NPC HITBOXES ON').last().waitFor();
  await page.keyboard.press('F6'); await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('RESUME'));
  await page.keyboard.press('F6'); await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('FREEZE'));
  if (await page.locator('.brand').textContent() !== 'YJSPS') throw new Error('Brand mismatch');
  fs.mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: `artifacts/solo-practice-${mapId}.png` });
  await delay(300); // Let shot effects expire and lazily uploaded weapon models settle.
  const current = await page.evaluate(() => { const perf = (window as any).__pcbPerf(); return { ...perf.scene, textures: perf.renderer.textures }; });
  const previous = resources.get(mapId);
  if (previous && (current.objects > previous.objects || current.geometries > previous.geometries || current.materials > previous.materials || current.textures > previous.textures)) throw new Error(`Resources grew on ${mapId}: ${JSON.stringify({previous,current})}`);
  resources.set(mapId, current);
  await page.keyboard.press('F5');
  await page.evaluate(() => document.exitPointerLock());
  }
  await page.locator('#leave').click();
  await page.locator('#menu:not(.hidden)').waitFor();
  await page.locator('#create').click();
  await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('1 / 8 PLAYERS'));
  await page.waitForFunction(() => (window as any).__pcbPerf().mapId === (window as any).__pcbPerf().authoritativeMapId);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ practice: true, hitboxes: true, freezeResume: true, multiplayerAfterExit: true, resources: Object.fromEntries(resources), errors }));
} finally { await browser.close(); server.kill(); }

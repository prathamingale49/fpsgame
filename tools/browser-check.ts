import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const port = 26674, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
const serverLogs: string[] = [];
server.stdout?.on('data', chunk => serverLogs.push(String(chunk)));
server.stderr?.on('data', chunk => serverLogs.push(String(chunk)));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await delay(100);
  }
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await contextA.newPage(), b = await contextB.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); }
  await Promise.all([a.goto(base), b.goto(base)]);
  await a.locator('#settings-toggle').click(); await a.locator('#quality').selectOption('low');
  if (await a.evaluate(() => localStorage.getItem('pcb-quality')) !== 'low') throw new Error('Graphics setting was not saved');
  await a.locator('#name').fill('Browser A'); await a.locator('#create').click();
  try { await a.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 }); }
  catch { throw new Error(`Initial join failed: ${await a.locator('#error').textContent()} browser=${errors.join(' | ')} server=${serverLogs.join(' | ')}`); }
  const code = (await a.locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
  if (!code) throw new Error('Room code missing');
  await b.locator('#name').fill('Browser B'); await b.locator('.join-details summary').click(); await b.locator('#code').fill(code); await b.locator('#join').click();
  await Promise.all([a.locator('#player-count').getByText('2 / 8 PLAYERS').waitFor(), b.locator('#player-count').getByText('2 / 8 PLAYERS').waitFor()]);
  await Promise.all([a.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 30000 }), b.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 30000 })]);
  await delay(500);
  await a.keyboard.down('Tab'); await a.locator('#scores').getByText('Browser B').waitFor(); await a.keyboard.up('Tab');
  const storedToken = await a.evaluate(() => sessionStorage.getItem('pcb-reconnection-token'));
  await a.reload();
  try { await a.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 }); }
  catch { throw new Error(`Reload reconnection failed: token=${Boolean(storedToken)} error=${await a.locator('#error').textContent()} browserErrors=${errors.join(' | ')}`); }
  await a.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 30000 });
  await a.locator('#pause').click(); await delay(200);
  const pointerLocked = await a.evaluate(() => document.pointerLockElement?.id === 'game');
  if (!pointerLocked) throw new Error('Pointer lock failed');
  const before = (await a.locator('#game').getAttribute('data-position'))?.split(',').map(Number);
  await a.keyboard.down('KeyW');
  await a.waitForFunction((start: number[]) => {
    const current = document.querySelector('#game')?.getAttribute('data-position')?.split(',').map(Number);
    return current && Math.hypot(current[0] - start[0], current[2] - start[2]) > .15;
  }, before!, { timeout: 8000 });
  await a.keyboard.up('KeyW');
  const after = (await a.locator('#game').getAttribute('data-position'))?.split(',').map(Number);
  if (!before || !after || Math.hypot(after[0] - before[0], after[2] - before[2]) < .15) throw new Error(`First-person movement was blocked at spawn: before=${before} after=${after} errors=${errors.join(' | ')}`);
  await delay(300);
  const stopped = (await a.locator('#game').getAttribute('data-position'))?.split(',').map(Number);
  if (!stopped || Math.hypot(stopped[0] - after[0], stopped[2] - after[2]) > .15) throw new Error(`Movement continued after releasing W: after=${after} stopped=${stopped}`);
  await a.keyboard.press('F3'); await a.locator('#perf-debug:visible').waitFor();
  await a.locator('#perf-debug').getByText('Pending inputs').waitFor({ timeout: 8000 });
  const debug = await a.locator('#perf-debug').textContent();
  if (!debug?.includes('Pending inputs') || !debug.includes('Draw calls')) throw new Error(`F3 metrics missing: ${debug}`);
  fs.mkdirSync('artifacts', { recursive: true });
  await a.screenshot({ path: path.resolve('artifacts/browser-a.png') });
  await b.screenshot({ path: path.resolve('artifacts/browser-b.png') });
  const pixels = await a.locator('#game').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2'); return { width: canvas.width, height: canvas.height, gl: !!gl };
  });
  if (!pixels.gl || pixels.width === 0 || pixels.height === 0) throw new Error('WebGL canvas not rendered');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ ok: true, room: code, twoClients: true, pointerLocked, moved: before && after ? Math.hypot(after[0] - before[0], after[2] - before[2]) : 0, canvas: pixels, debug, screenshots: ['artifacts/browser-a.png', 'artifacts/browser-b.png'] }, null, 2));
} finally { await browser?.close(); server.kill(); }

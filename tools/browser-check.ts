import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const port = 26674, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
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
  await a.locator('#name').fill('Browser A'); await a.locator('#create').click();
  await a.locator('#hud:not(.hidden)').waitFor();
  const code = (await a.locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
  if (!code) throw new Error('Room code missing');
  await b.locator('#name').fill('Browser B'); await b.locator('#code').fill(code); await b.locator('#join').click();
  await Promise.all([a.locator('#player-count').getByText('2 / 8 PLAYERS').waitFor(), b.locator('#player-count').getByText('2 / 8 PLAYERS').waitFor()]);
  await a.keyboard.down('Tab'); await a.locator('#scores').getByText('Browser B').waitFor(); await a.keyboard.up('Tab');
  await a.locator('#game').click(); await delay(200);
  const pointerLocked = await a.evaluate(() => document.pointerLockElement?.id === 'game');
  if (!pointerLocked) throw new Error('Pointer lock failed');
  await a.keyboard.down('KeyW'); await delay(300); await a.keyboard.up('KeyW');
  fs.mkdirSync('artifacts', { recursive: true });
  await a.screenshot({ path: path.resolve('artifacts/browser-a.png') });
  await b.screenshot({ path: path.resolve('artifacts/browser-b.png') });
  const pixels = await a.locator('#game').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2'); return { width: canvas.width, height: canvas.height, gl: !!gl };
  });
  if (!pixels.gl || pixels.width === 0 || pixels.height === 0) throw new Error('WebGL canvas not rendered');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ ok: true, room: code, twoClients: true, pointerLocked, canvas: pixels, screenshots: ['artifacts/browser-a.png', 'artifacts/browser-b.png'] }, null, 2));
} finally { await browser?.close(); server.kill(); }

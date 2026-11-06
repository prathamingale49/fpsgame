import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const cwd = path.resolve(process.env.BENCH_TARGET || '.');
const map = process.env.BENCH_MAP || 'bms';
const players = Number(process.env.BENCH_PLAYERS || 1);
const port = 26680, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { cwd, env: { ...process.env, PORT: String(port), PCB_TEST_MAP: map === 'test' ? '1' : '0' }, stdio: 'pipe' });
const logs: string[] = [];
server.stdout?.on('data', chunk => logs.push(String(chunk)));
server.stderr?.on('data', chunk => logs.push(String(chunk)));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ } await delay(100); }
  const health = await (await fetch(`${base}/api/health`)).json() as { map: string };
  if (health.map !== map) throw new Error(`Expected ${map} map, got ${health.map}`);
  const contexts = await Promise.all(Array.from({ length: players }, () => browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all(pages.map(page => page.goto(base)));
  const a = pages[0];
  await a.locator('#name').fill('Bench A'); await a.locator('#create').click();
  await a.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  const code = (await a.locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
  for (let i = 1; i < players; i++) {
    await pages[i].locator('.join-details summary').click(); await pages[i].locator('#code').fill(code!); await pages[i].locator('#join').click();
    await pages[i].locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  }
  await a.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 });
  await delay(500);
  const result = await a.evaluate(`(async () => {
    const samples = [];
    await new Promise(resolve => {
      let previous = 0;
      const sample = now => { if (previous) samples.push(now - previous); previous = now; if (samples.length < 30) requestAnimationFrame(sample); else resolve(); };
      requestAnimationFrame(sample);
    });
    samples.sort((x, y) => x - y);
    const canvas = document.querySelector('canvas');
    return { medianMs: samples[14], p95Ms: samples[28], meanMs: samples.reduce((x, y) => x + y, 0) / samples.length, canvas: [canvas.width, canvas.height] };
  })()`) as { medianMs: number; p95Ms: number; meanMs: number; canvas: number[] };
  console.log(JSON.stringify({ map, players, ...result, target: cwd }, null, 2));
} catch (error) { console.error(error, logs.join(' | ')); process.exitCode = 1; }
finally { await browser.close(); server.kill(); }

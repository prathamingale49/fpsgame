import { chromium, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { MOVEMENT_PROTOCOL } from '../shared/game.js';

const seconds = Number(process.env.SOAK_SECONDS || 180);
if (seconds < 180 || seconds > 300) throw new Error('SOAK_SECONDS must be between 180 and 300');
const port = 26706, base = `http://127.0.0.1:${port}`;
const map = fs.existsSync('assets/public/maps/bms.glb') ? 'bms' : 'test';
const server = spawn(process.execPath, ['dist-server/main.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PCB_TEST_MAP: map === 'test' ? '1' : '0', PCB_SOAK_METRICS: '1' }, stdio: 'pipe' });
const serverLogs: string[] = [];
server.stdout?.on('data', chunk => serverLogs.push(String(chunk)));
server.stderr?.on('data', chunk => serverLogs.push(String(chunk)));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
type Perf = { frameTimes: number[]; playCorrections: number[]; pending: number; maxPending: number; correction: number; maxCorrection: number; renderer: { geometries: number; textures: number; calls: number; triangles: number }; gpu: string; cache: { cells: number; queries: number }; heapMB: number; position: number[]; authoritative: number[] | null };
type Health = { map: string; movementProtocol: number; perf: { ticks: number; tickMsTotal: number; tickMsMax: number; queueMax: number; queueTotal: number; processed: number; cache: { cells: number; queries: number }; heapMB: number } };
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
const summary = (p: Perf) => ({ frames: p.frameTimes.length, fps: +(1000 / (p.frameTimes.reduce((a, b) => a + b, 0) / p.frameTimes.length)).toFixed(1), medianMs: +percentile(p.frameTimes, .5).toFixed(1), p95Ms: +percentile(p.frameTimes, .95).toFixed(1), pending: p.pending, maxPending: p.maxPending, correctionP95: +percentile(p.playCorrections, .95).toFixed(3), maxCorrection: p.maxCorrection, renderer: p.renderer, gpu: p.gpu, cache: p.cache, heapMB: p.heapMB, position: p.position });
async function sample(pages: Page[]) {
  const clients = await Promise.all(pages.map(page => page.evaluate(() => (window as unknown as { __pcbPerf: () => Perf }).__pcbPerf())));
  const health = await (await fetch(`${base}/api/health`)).json() as Health;
  return { clients, server: health.perf };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ } await delay(100); }
  const health = await (await fetch(`${base}/api/health`)).json() as Health;
  if (health.map !== map || health.movementProtocol !== MOVEMENT_PROTOCOL || !health.perf) throw new Error(`Server build mismatch: ${JSON.stringify(health)}`);
  const hardware = process.env.SOAK_RENDERER === 'hardware';
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: hardware
    ? ['--enable-gpu', '--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--disable-software-rasterizer']
    : ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pages = await Promise.all([0, 1].map(async () => {
    const context = await browser!.newContext({ viewport: { width: 400, height: 280 } });
    const page = await context.newPage(); await page.goto(`${base}/?soakTest=1`);
    await page.locator('#settings-toggle').click(); await page.locator('#quality').selectOption('low');
    return page;
  }));
  const errors: string[] = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  await pages[0].locator('#name').fill('Soak A'); await pages[0].locator('#create').click();
  await pages[0].locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  const code = (await pages[0].locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
  if (!code) throw new Error('Room code missing');
  await pages[1].locator('#name').fill('Soak B'); await pages[1].locator('.join-details summary').click(); await pages[1].locator('#code').fill(code); await pages[1].locator('#join').click();
  await Promise.all(pages.map(page => page.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 90000 })));
  for (const page of pages) {
    await page.evaluate(() => (window as unknown as { __pcbStartSoak: () => void }).__pcbStartSoak());
  }
  await delay(30000);
  const initial = await sample(pages);
  console.log(JSON.stringify({ phase: 'initial', elapsedSeconds: 30, clients: initial.clients.map(summary), server: initial.server }));
  await delay((seconds - 60) * 1000);
  await Promise.all(pages.map(page => page.evaluate(() => (window as unknown as { __pcbResetPerfWindow: () => void }).__pcbResetPerfWindow())));
  await delay(30000);
  const final = await sample(pages);
  const result = { map, seconds, initial: { clients: initial.clients.map(summary), server: initial.server }, final: { clients: final.clients.map(summary), server: final.server }, errors,
    serverTickEarlyMs: initial.server.tickMsTotal / initial.server.ticks,
    serverTickLateMs: (final.server.tickMsTotal - initial.server.tickMsTotal) / (final.server.ticks - initial.server.ticks),
    serverLogs: serverLogs.join('').slice(-4000) };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(path.resolve('artifacts/gameplay-soak.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  const initialSummary = initial.clients.map(summary), finalSummary = final.clients.map(summary);
  const degraded = finalSummary.some((client, index) => {
    const first = initialSummary[index], software = client.gpu.includes('SwiftShader');
    const frameRegression = software ? client.p95Ms > first.p95Ms * 1.2 : client.fps < first.fps * .9 || client.p95Ms > first.p95Ms * 1.15;
    return frameRegression || client.pending > 60 || client.maxPending > 80 || client.correctionP95 > .75
      || client.cache.queries > 256 || client.renderer.textures !== first.renderer.textures
      || client.renderer.geometries > first.renderer.geometries + 16 || client.heapMB > first.heapMB + 10;
  });
  const serverRegression = result.serverTickLateMs > result.serverTickEarlyMs * 2 + .1 || final.server.queueMax > 100
    || final.server.cache.queries > 256 || final.server.heapMB > initial.server.heapMB + 10;
  if (errors.length || degraded || serverRegression) throw new Error('Soak found progressive degradation, browser errors, or sustained input backlog');
} finally { await browser?.close(); server.kill(); }

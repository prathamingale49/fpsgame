import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { initialMotion, MOVEMENT_PROTOCOL, stepMotion, type MapData } from '../shared/game.js';

const map = process.env.MOVE_MAP || 'test';
const latency = Number(process.env.MOVE_LATENCY || 0);
const frameMs = Number(process.env.MOVE_FRAME_MS || 0);
const holdMs = Number(process.env.MOVE_HOLD_MS || 1600);
const moveTicks = Math.ceil(holdMs / 1000 * 60);
const port = 26681, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PCB_TEST_MAP: map === 'test' ? '1' : '0', PCB_MOVEMENT_TRACE: process.env.MOVE_SERVER_TRACE ?? '1' }, stdio: 'pipe' });
const serverLogs: string[] = [];
server.stdout?.on('data', chunk => serverLogs.push(String(chunk)));
server.stderr?.on('data', chunk => serverLogs.push(String(chunk)));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ } await delay(100); }
  const health = await (await fetch(`${base}/api/health`)).json() as { map: string; movementProtocol?: number };
  if (health.map !== map || health.movementProtocol !== MOVEMENT_PROTOCOL) throw new Error(`Wrong server build or map: ${JSON.stringify(health)}`);
  const mapData = await (await fetch(`${base}/api/map`)).json() as MapData;
  const yaw = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(angle => {
    let motion = initialMotion(mapData.spawns[0]);
    for (let i = 0; i < 96; i++) motion = stepMotion(motion, { seq: i + 1, forward: 1, strafe: 0, yaw: angle, pitch: 0, jump: false, sprint: false }, mapData);
    return { angle, distance: Math.hypot(motion.x - mapData.spawns[0][0], motion.z - mapData.spawns[0][2]), safe: motion.y >= mapData.ground - 1 };
  }).filter(route => route.safe).sort((a, b) => b.distance - a.distance)[0]?.angle ?? 0;
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const aContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const bContext = await browser.newContext({ viewport: { width: 640, height: 400 } });
  if (frameMs) await aContext.addInitScript({ content: `(() => { const native = window.requestAnimationFrame.bind(window); let last = 0; window.requestAnimationFrame = callback => native(now => { const wait = Math.max(0, ${frameMs} - (now - last)); setTimeout(() => { last = performance.now(); callback(last); }, wait); }); })();` });
  if (latency) await aContext.routeWebSocket(/ws:\/\/127\.0\.0\.1/, ws => {
    const upstream = ws.connectToServer();
    const delayed = (send: (value: string | Buffer) => void) => {
      const queue: { due: number; value: string | Buffer }[] = [];
      let lastDue = 0, timer: ReturnType<typeof setTimeout> | undefined, counter = 0;
      const flush = () => {
        timer = undefined;
        while (queue.length && queue[0].due <= Date.now()) send(queue.shift()!.value);
        if (queue.length) timer = setTimeout(flush, Math.max(0, queue[0].due - Date.now()));
      };
      return (value: string | Buffer) => {
        const jitter = ((counter++ * 17) % 41) - 20;
        lastDue = Math.max(Date.now() + latency + jitter, lastDue);
        queue.push({ due: lastDue, value });
        if (!timer) timer = setTimeout(flush, Math.max(0, queue[0].due - Date.now()));
      };
    };
    ws.onMessage(delayed(value => upstream.send(value)));
    upstream.onMessage(delayed(value => ws.send(value)));
  });
  const a = await aContext.newPage(), b = await bContext.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([a.goto(`${base}/?movementTrace=1`), b.goto(`${base}/?movementTrace=1`)]);
  for (const page of [a, b]) { await page.locator('#settings-toggle').click(); await page.locator('#quality').selectOption('low'); }
  await a.locator('#create').click(); await a.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  const code = (await a.locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
  if (!code) throw new Error('Room code missing');
  await b.locator('.join-details summary').click(); await b.locator('#code').fill(code); await b.locator('#join').click();
  await b.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  await Promise.all([a.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 }), b.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 })]);
  if (await a.evaluate(() => document.pointerLockElement?.id !== 'game')) await a.locator('#pause').click();
  if (await a.evaluate(() => document.pointerLockElement?.id !== 'game')) throw new Error('Pointer lock missing');
  await delay(300);
  const before = await a.evaluate(() => (window as Window & { __pcbMovementTrace?: { predicted: number[] }[] }).__pcbMovementTrace?.at(-1)?.predicted);
  await a.evaluate(({ ticks, angle }) => (window as unknown as { __pcbStartMovementTest: (ticks: number, yaw: number) => void }).__pcbStartMovementTest(ticks, angle), { ticks: moveTicks, angle: yaw });
  await a.waitForFunction((ticks: number) => {
    const trace = (window as Window & { __pcbMovementTrace?: { event: string; forward: number }[] }).__pcbMovementTrace ?? [];
    return trace.filter(event => event.event === 'input' && event.forward === 1).length >= ticks && trace.at(-1)?.forward === 0;
  }, moveTicks, { timeout: 120000 });
  await delay(900);
  try { await a.waitForFunction(() => ((window as Window & { __pcbMovementTrace?: { pending: number }[] }).__pcbMovementTrace?.at(-1)?.pending ?? Infinity) < 35, undefined, { timeout: 10000 }); }
  catch { /* preserve the trace for diagnosis and fail on the final assertions */ }
  await delay(300);
  type Event = { event: string; time: number; seq: number; ack: number; pending: number; predicted: [number, number, number]; authoritative: [number, number, number]; correction: number; yaw: number; forward: number };
  type Snapshot = { time: number; players: { id: string; ack: number; position: [number, number, number] }[] };
  const trace = await a.evaluate(() => (window as Window & { __pcbMovementTrace?: Event[] }).__pcbMovementTrace ?? []);
  const snapshots = await b.evaluate(() => (window as Window & { __pcbMovementSnapshots?: Snapshot[] }).__pcbMovementSnapshots ?? []);
  const serverEvents = serverLogs.join('').split(/\r?\n/).filter(line => line.startsWith('MOVE_TRACE ')).map(line => JSON.parse(line.slice(11)));
  const result = { map, latency, frameMs, holdMs, before, trace, snapshots, serverEvents, errors };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(path.resolve(`artifacts/movement-${map}-${latency}-${frameMs}.json`), JSON.stringify(result));
  const moving = trace.filter(event => event.event === 'input' && event.forward === 1);
  const first = moving[0], last = moving.at(-1);
  if (!first || !last || !before || last.time - first.time < 1000) throw new Error(`W was not held through 1 second of inputs; diagnostic: ${path.resolve(`artifacts/movement-${map}-${latency}-${frameMs}.json`)}`);
  const direction: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
  const project = (position: [number, number, number]) => position[0] * direction[0] + position[2] * direction[1];
  const clientMovement = project(last.predicted) - project(first.predicted);
  const activeSnapshots = trace.filter(event => event.event === 'snapshot' && event.time >= first.time && event.time <= last.time);
  const maxCorrection = Math.max(0, ...activeSnapshots.map(event => event.correction));
  const backwards = activeSnapshots.slice(1).filter((event, i) => project(event.predicted) < project(activeSnapshots[i].predicted) - .25);
  const playerId = snapshots[0]?.players.reduce((best, player) => Math.hypot(player.position[0] - before[0], player.position[2] - before[2]) < Math.hypot(best.position[0] - before[0], best.position[2] - before[2]) ? player : best)?.id;
  const authoritative = snapshots.map(snapshot => snapshot.players.find(player => player.id === playerId)).filter((player): player is NonNullable<typeof player> => !!player);
  const serverMovement = authoritative.length ? project(authoritative.at(-1)!.position) - project(authoritative[0].position) : 0;
  const finalSeparation = authoritative.length && trace.length ? Math.abs(project(trace.at(-1)!.predicted) - project(authoritative.at(-1)!.position)) : Infinity;
  const serverBackwards = authoritative.slice(1).filter((player, i) => project(player.position) < project(authoritative[i].position) - .25);
  const serverChanges = authoritative.slice(1).filter((player, i) => project(player.position) > project(authoritative[i].position) + .01).length;
  const released = trace.filter(event => event.event === 'input' && event.time > last.time);
  const afterRelease = trace.filter(event => event.event === 'snapshot' && event.time > last.time + 400);
  const releaseDrift = afterRelease.length ? Math.max(...afterRelease.map(event => project(event.predicted))) - Math.min(...afterRelease.map(event => project(event.predicted))) : Infinity;
  const queueSizes = serverEvents.map(event => event.queue).filter((size): size is number => typeof size === 'number');
  const summary = { map, latency, frameMs, holdMs, clientMovement, serverMovement, serverChanges, finalSeparation, maxCorrection, backwards: backwards.length, serverBackwards: serverBackwards.length, releaseDrift, pendingAtEnd: trace.at(-1)?.pending, maxServerQueue: queueSizes.length ? Math.max(...queueSizes) : null, errors };
  console.log(JSON.stringify(summary, null, 2));
  if (clientMovement < 5 || serverMovement < 5 || serverChanges < 4 || finalSeparation > 1 || backwards.length || serverBackwards.length || maxCorrection > .75 || !released.length || released.some(event => event.forward !== 0) || releaseDrift > .25 || errors.length) throw new Error(`Sustained movement regression: ${path.resolve(`artifacts/movement-${map}-${latency}-${frameMs}.json`)}`);
} finally { await browser?.close(); server.kill(); }

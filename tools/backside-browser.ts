import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
fs.mkdirSync('artifacts', { recursive: true });
try {
  for (const [edge, yaw] of [['north', 0], ['south', Math.PI], ['east', -Math.PI / 2], ['west', Math.PI / 2]] as const) {
    const port = 26688, base = `http://localhost:${port}`;
    const server = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/bms-side-server.ts'], { env: { ...process.env, PORT: String(port), TEST_EDGE: edge }, stdio: 'pipe' });
    let logs = ''; server.stderr?.on('data', chunk => { logs += chunk; });
    const ca = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const cb = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ca.addInitScript(() => localStorage.setItem('pcb-quality', 'low'));
    await cb.addInitScript(() => localStorage.setItem('pcb-quality', 'low'));
    try {
      let ready = false;
      for (let i = 0; i < 80; i++) { try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch {} await delay(100); }
      if (!ready) throw new Error(`Fixture failed: ${logs}`);
      const a = await ca.newPage(), b = await cb.newPage();
      const errors: string[] = [];
      for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
      await a.goto(`${base}/?movementTrace`); await b.goto(`${base}/?movementTrace`);
      await a.locator('#create').click();
      try { await a.locator('#hud:not(.hidden)').waitFor(); }
      catch { throw new Error(`Join failed: ${await a.locator('#error').textContent()} errors=${errors} server=${logs}`); }
      const code = (await a.locator('#room-label').textContent())?.match(/ROOM ([A-Z0-9]+)/)?.[1];
      if (!code) throw new Error('Missing room code');
      await b.locator('#code').fill(code); await b.locator('#join').click();
      await b.locator('#hud:not(.hidden)').waitFor();
      await a.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 });
      const start = async (testYaw: number, ticks = 18) => a.evaluate(({ y, ticks }) => (window as any).__pcbStartMovementTest(ticks, y), { y: testYaw, ticks });
      await start(yaw);
      await a.waitForFunction(() => { const p = (window as any).__pcbPerf(); return p.side === 'back' && p.authoritativeSide === 'back' && p.pending === 0 && p.testRemaining === 0; }, null, { timeout: 20000 });
      await a.locator('#game[data-side="back"]').waitFor();
      const back = await a.evaluate(() => (window as any).__pcbPerf());
      if (back.cameraRoll !== 0 || Math.abs(back.worldRotation - Math.PI) > .001) throw new Error(`Camera/world orientation wrong: ${JSON.stringify(back)}`);
      if (await a.locator('#side-label').textContent() !== 'BACK') throw new Error('HUD side mismatch');
      await b.waitForFunction(() => (window as any).__pcbMovementSnapshots.some((s: any) => s.players.some((p: any) => p.side === 'back')), null, { timeout: 15000 });
      await a.screenshot({ path: `artifacts/bms-back-${edge}.png` });
      // Return across the extra safety inset as well as the distance walked in.
      await start(yaw + Math.PI, 30);
      try { await a.waitForFunction(() => { const p = (window as any).__pcbPerf(); return p.side === 'front' && p.authoritativeSide === 'front' && p.pending === 0 && p.testRemaining === 0; }, null, { timeout: 20000 }); }
      catch { throw new Error(`Return failed at ${edge}: ${JSON.stringify(await a.evaluate(() => { const p = (window as any).__pcbPerf(); return { side: p.side, authoritativeSide: p.authoritativeSide, position: p.position, authoritative: p.authoritative, pending: p.pending }; }))}`); }
      await a.locator('#game[data-side="front"]').waitFor();
      const front = await a.evaluate(() => (window as any).__pcbPerf());
      if (front.cameraRoll !== 0 || front.worldRotation !== 0) throw new Error('Front camera/world orientation wrong');
      await a.screenshot({ path: `artifacts/bms-front-${edge}.png` });
      if (errors.length) throw new Error(errors.join('\n'));
      console.log(JSON.stringify({ edge, roundTrip: true, back: back.position, front: front.position, errors }));
    } finally { await ca.close(); await cb.close(); server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  }
} finally { await browser.close(); }

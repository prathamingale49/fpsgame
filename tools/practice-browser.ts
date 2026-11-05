import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
const port = 26696, base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['dist-server/main.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await delay(100); }
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.addInitScript(() => localStorage.setItem('pcb-quality', 'low'));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.locator('#practice').click();
  await page.locator('#hud:not(.hidden)').waitFor({ timeout: 30000 });
  await page.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('5 NPC TARGETS'));
  await page.keyboard.press('F5'); await page.locator('#kill-feed').getByText('NPC HITBOXES ON').waitFor();
  await page.keyboard.press('F6'); await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('RESUME'));
  await page.keyboard.press('F6'); await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('FREEZE'));
  if (await page.locator('.brand').textContent() !== 'YJSPS') throw new Error('Brand mismatch');
  fs.mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/solo-practice.png' });
  await page.keyboard.press('Escape'); await page.locator('#leave').click();
  await page.locator('#menu:not(.hidden)').waitFor(); await page.locator('#create').click();
  await page.waitForFunction(() => document.querySelector('#player-count')?.textContent?.includes('1 / 8 PLAYERS'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ practice: true, hitboxes: true, freezeResume: true, multiplayerAfterExit: true, errors }));
} finally { await browser.close(); server.kill(); }

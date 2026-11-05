import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); console.log(e.message); });
  // Expose the existing presentation function only in this intercepted test page.
  await page.route('**/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nwindow.__previewElimination = showElimination; window.__previewFeed = showFeed;' });
  });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => typeof (window as any).__previewElimination === 'function', null, { timeout: 10000 });
  await page.evaluate(() => { document.querySelector('#menu')!.classList.add('hidden'); document.querySelector('#hud')!.classList.remove('hidden'); });
  for (const [chain, label] of [[1, ''], [2, 'DOUBLE KILL'], [3, 'TRIPLE KILL']] as const) {
    await page.evaluate(chain => (window as any).__previewElimination({ name: 'Engineer', chain }), chain);
    if (await page.locator('#elimination-chain').textContent() !== label) throw new Error('Wrong chain label');
    if (await page.locator('#elimination-name').textContent() !== 'Engineer') throw new Error('Missing target name');
    if (!await page.locator('#elimination').isVisible()) throw new Error('Banner hidden');
  }
  await page.evaluate(() => {
    (window as any).__previewFeed('Engineer eliminated Rival', 2);
    (window as any).__previewFeed('Engineer eliminated Target', 3);
  });
  if (await page.locator('.feed-streak-badge').count() !== 2) throw new Error('Missing streak badges');
  if (!(await page.locator('.feed-streak-hot').textContent())?.includes('x3')) throw new Error('Triple streak not highlighted');
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/elimination-triple.png' });
  await page.locator('#elimination').waitFor({ state: 'hidden' });
  await page.evaluate(() => (window as any).__previewElimination({ name: '<img src=x>', chain: 1 }));
  if (await page.locator('#elimination-name img').count()) throw new Error('Name interpreted as HTML');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Single/double/triple banner, expiry, escaped names, and browser runtime checks passed');
} finally { await browser.close(); }

import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('pcb-quality', 'low'));
  await page.goto('http://localhost:5173'); await page.locator('#practice').click();
  await page.locator('#game[data-model-loaded="true"]').waitFor({ timeout: 60000 });
  await page.locator('#game').click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press('Digit5');
  await page.locator('.ammo small').getByText('CAPACITOR SNIPER').waitFor();
  await page.mouse.down({ button: 'right' });
  await page.locator('#crosshair.sniper-ads').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/capacitor-sniper-ads.png' });
  await page.mouse.click(550, 375);
  await page.waitForFunction(() => document.querySelector('#ammo')?.textContent === '0');
  await page.waitForFunction(() => document.querySelector('#weapon-status')?.textContent?.includes('RECHARGING'));
  await page.keyboard.press('Digit1'); await page.keyboard.press('Digit5');
  await page.waitForFunction(() => document.querySelector('#ammo')?.textContent === '0');
  await page.waitForFunction(() => document.querySelector('#ammo')?.textContent === '1');
  await page.mouse.up({ button: 'right' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, map: 'bms', fifthSlot: true, ads: true, instantShot: true, rechargeAcrossSwitch: true, errors }));
} finally { await browser.close(); }

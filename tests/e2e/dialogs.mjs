// Every dialog opens, takes focus, and closes with Escape (needs the dev server on :5180).
//   node tests/e2e/dialogs.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5180/?file=Goose');
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback, null, { timeout: 60000 });
await page.click('#tipsClose').catch(() => {});
let failed = 0;
for (const [name, open, id] of [
  ['help', () => page.keyboard.press('?'), 'helpModal'],
  ['progress', () => page.click('#goalRing'), 'progressModal'],
  ['tuner', () => page.keyboard.press('u'), 'tunerModal'],
]) {
  await open();
  await page.waitForTimeout(400);
  const opened = await page.isVisible(`#${id}`);
  const focusInside = await page.evaluate((id) => document.getElementById(id).contains(document.activeElement), id);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = !(await page.isVisible(`#${id}`));
  const ok = opened && focusInside && closed;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: opened=${opened} focusInside=${focusInside} closedByEscape=${closed}`);
}
// Menus close with Escape without clearing the loop.
await page.keyboard.press('4');
await page.waitForTimeout(300);
await page.click('#displayBtn');
await page.keyboard.press('Escape');
const menuClosed = !(await page.evaluate(() => document.getElementById('displayMenu').classList.contains('open')));
const loopKept = await page.evaluate(() => !!api.playbackRange);
console.log(`${menuClosed && loopKept ? 'OK  ' : 'FAIL'} menu Escape: closed=${menuClosed} loopKept=${loopKept}`);
if (!(menuClosed && loopKept)) failed++;
console.log(`${errors.length} page errors`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);

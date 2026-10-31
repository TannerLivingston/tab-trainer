// Random-interaction fuzz test: presses shortcuts, clicks visible controls and switches songs,
// failing on any uncaught page error.  node scripts/fuzz.mjs [seconds] [seed] [fakeMicWav]
import { chromium } from 'playwright-core';
const [secs = '60', seedArg = '1', wav] = process.argv.slice(2);
let seed = Number(seedArg);
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const args = ['--autoplay-policy=no-user-gesture-required'];
if (wav) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch({ args });
const phone = process.env.PHONE === '1';
const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: phone, isMobile: phone, permissions: wav ? ['microphone'] : [] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(process.env.STACK ? (e.stack ?? e.message).split('\n').slice(0, 6).join(' | ') : e.message));
page.on('dialog', (d) => d.dismiss());
await page.goto('http://127.0.0.1:5180/?file=Goose');
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback, null, { timeout: 60000 });
const keys = [' ', ' ', 'Enter', 'ArrowLeft', 'ArrowRight', '[', ']', ',', '.', 'l', 's', 'm', 'c', 'f', 'o', 'k', 'n', 'p', 'w', 'u', 't', 'b', '-', '=', '?', 'Escape', 'Escape', 'PageDown', 'PageUp'];
const end = Date.now() + Number(secs) * 1000;
let actions = 0;
while (Date.now() < end) {
  const r = rand();
  try {
    if (r < 0.55) await page.keyboard.press(pick(keys));
    else if (r < 0.9) {
      const handles = await page.$$('button:visible, .chord-card:visible, .menu-item:visible');
      const safe = [];
      for (const h of handles) {
        const id = (await h.getAttribute('id')) ?? '';
        // Skip controls that open OS dialogs (file pickers, print) or install prompts.
        if (/openBtn|emptyOpen|recLoadBtn|printBtn|midiBtn|installBtn|backupBtn|restoreBtn/.test(id)) continue;
        safe.push(h);
      }
      if (safe.length) await pick(safe).click({ timeout: 1000, force: true });
    } else {
      await page.evaluate(() => document.getElementById('libraryBtn').click());
      const items = await page.$$('#libraryMenu .menu-item');
      if (items.length) await pick(items).click({ timeout: 1000 });
    }
  } catch (e) {
    /* element went away mid-action: fine */
  }
  actions++;
  await page.waitForTimeout(40 + rand() * 260);
}
const alive = await page.evaluate(() => !!window.api?.score).catch(() => false);
console.log(`${actions} actions, ${errors.length} page errors, app alive: ${alive}`);
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ERROR:', e);
await browser.close();
process.exit(errors.length ? 1 : 0);

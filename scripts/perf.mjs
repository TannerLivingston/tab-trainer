// Measures main-thread long tasks while playing with every panel open. node scripts/perf.mjs [file] [cpuSlowdown]
import { chromium } from 'playwright-core';
const [file = 'Goose', slow = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slow) });
await page.goto(`http://127.0.0.1:5180/?file=${encodeURIComponent(file)}&fretboard=1`);
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 120000 });
await page.keyboard.press('k');
await page.waitForTimeout(1000);
await page.evaluate(() => {
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false });
});
await page.keyboard.press('Space');
await page.waitForTimeout(10000);
await page.keyboard.press('Space');
const long = await page.evaluate(() => window.__long);
const bar = await page.$eval('#posBar', (e) => e.textContent);
console.log(`${file} @${slow}x CPU: ${long.length} long tasks in 10s (max ${Math.max(0, ...long)} ms, total ${long.reduce((a, b) => a + b, 0)} ms) · reached bar ${bar}`);
await browser.close();

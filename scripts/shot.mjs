// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [fullPage]
import { chromium } from 'playwright-core';
const [url, out, wait = '6000', full = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, fullPage: !!full });
await browser.close();

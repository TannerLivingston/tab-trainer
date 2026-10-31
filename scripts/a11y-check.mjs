// Runs axe-core against the app with a song loaded. node scripts/a11y-check.mjs [url]
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const url = process.argv[2] ?? 'http://127.0.0.1:5180/?file=Goose&fretboard=1';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback, null, { timeout: 60000 });
await page.waitForTimeout(1000);
await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
const res = await page.evaluate(async () =>
  // The engraved score is an SVG drawing owned by alphaTab; audit the app around it.
  await axe.run({ exclude: [['#alphaTab']] }, { resultTypes: ['violations'] }),
);
for (const v of res.violations) {
  console.log(`${v.impact.toUpperCase()} ${v.id}: ${v.help} (${v.nodes.length})`);
  for (const n of v.nodes.slice(0, 4)) console.log('   ', n.target.join(' '), '-', n.failureSummary?.split('\n')[1]?.trim());
}
console.log(`${res.violations.length} rule violations`);
await browser.close();

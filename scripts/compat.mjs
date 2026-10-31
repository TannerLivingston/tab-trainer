// Compatibility check: opens each file in the app (headless Chromium), then reports parse/render
// errors, what was read, whether playback advances and makes sound, and saves a screenshot.
//
//   node scripts/compat.mjs <outDir> <file...>      (needs the dev server on :5180)
import { chromium } from 'playwright-core';
import { basename, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const [outArg, ...files] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://127.0.0.1:5180';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];

for (const file of files) {
  const name = basename(file);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`));
  // Meter the synth output: mirror connections to the destination into an analyser.
  await page.addInitScript(() => {
    const orig = AudioNode.prototype.connect;
    window.__peak = 0;
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = orig.call(this, dest, ...rest);
      if (dest instanceof AudioDestinationNode && !dest.context.__meter) {
        const an = dest.context.createAnalyser();
        an.fftSize = 2048;
        dest.context.__meter = an;
        const buf = new Float32Array(an.fftSize);
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) window.__peak = Math.max(window.__peak, Math.abs(v));
        }, 50);
      }
      if (dest instanceof AudioDestinationNode) orig.call(this, dest.context.__meter);
      return r;
    };
  });

  const r = { name, ok: false };
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.api, null, { timeout: 15000 });
    await page.setInputFiles('#fileInput', file);
    const loaded = await page
      .waitForFunction(() => window.api.score && window.api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1200);
    const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
    if (!loaded) {
      r.error = toast || 'did not load';
    } else {
      Object.assign(
        r,
        await page.evaluate(() => {
          const s = window.api.score;
          let notes = 0;
          for (const t of s.tracks) for (const st of t.staves) for (const b of st.bars) for (const v of b.voices) for (const bt of v.beats) notes += bt.notes.length;
          return {
            title: s.title,
            tracks: s.tracks.map((t) => `${t.name || '?'}${t.staves[0]?.isPercussion ? ' (drums)' : ''}`),
            bars: s.masterBars.length,
            notes,
            glyphs: document.querySelectorAll('#alphaTab svg text, #alphaTab svg path').length,
            tuning: document.querySelector('.track .tag')?.textContent ?? '',
          };
        }),
      );
      const t0 = await page.evaluate(() => window.api.tickPosition);
      await page.keyboard.press('Space');
      await page.waitForTimeout(3500);
      await page.screenshot({ path: join(out, `${name}.png`) });
      Object.assign(
        r,
        await page.evaluate(() => ({ advanced: window.api.tickPosition, peak: window.__peak, bar: document.getElementById('posBar').textContent })),
      );
      r.advanced -= t0;
      await page.keyboard.press('Space');
      // Very short files can finish (and rewind) within the listening window, so sound counts too.
      r.ok = r.glyphs > 20 && (r.advanced > 0 || r.peak > 0.01);
    }
  } catch (e) {
    r.error = String(e.message ?? e).split('\n')[0];
  }
  r.errors = errors;
  results.push(r);
  const sound = r.peak === undefined ? '' : r.peak > 0.01 ? `sound ${(20 * Math.log10(r.peak)).toFixed(0)}dBFS` : 'SILENT';
  console.log(
    `${r.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(26)} ${r.error ? `error: ${r.error}` : `${r.bars} bars, ${r.notes} notes, ${r.tracks.length} tracks [${r.tracks.join(', ')}] · ${sound} · at ${r.bar}`}${errors.length ? `\n     ${errors.join('\n     ')}` : ''}`,
  );
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));

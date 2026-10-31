// End-to-end check of wait mode with a synthesised microphone (needs the dev server on :5180).
//   node tests/e2e/wait-mode.mjs <scratchDir>
// Writes a WAV of plucked notes matching the first targets of Goose, feeds it to Chromium as the
// mic, and checks that playback pauses at each note and moves on when the note is "played".
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] ?? '.';
let browser = await chromium.launch();
let page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/?file=Goose');
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback && api.tickCache, null, { timeout: 60000 });
const targets = await page.evaluate(() => {
  const byTick = new Map();
  for (const bar of api.score.tracks[0].staves[0].bars.slice(0, 3))
    for (const v of bar.voices)
      for (const b of v.beats) {
        const ps = b.notes.filter((n) => n.fret >= 0 && !n.isDead && !n.isTieDestination).map((n) => n.realValue);
        if (!b.isRest && ps.length) byTick.set(api.tickCache.getBeatStart(b), [...(byTick.get(api.tickCache.getBeatStart(b)) || []), ...ps]);
      }
  return [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, ps]) => ({ tick, ps }));
});
await browser.close();
const sr = 48000, notes = targets.slice(0, 8), lead = 2, gap = 0.9;
const len = Math.floor(sr * (lead + notes.length * gap + 2));
const pcm = new Float32Array(len);
notes.forEach((t, k) => {
  const f = 440 * 2 ** ((Math.max(...t.ps) - 69) / 12), period = Math.round(sr / f);
  const ring = Float32Array.from({ length: period }, () => Math.random() * 2 - 1);
  const start = Math.floor(sr * (lead + k * gap));
  for (let i = 0, p = 0; i < sr * 0.7; i++, p = (p + 1) % period) {
    const v = ring[p];
    ring[p] = 0.996 * 0.5 * (ring[p] + ring[(p + 1) % period]);
    pcm[start + i] += v * 0.5 * Math.min(1, (sr * 0.7 - i) / (sr * 0.05));
  }
});
const buf = Buffer.alloc(44 + len * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len * 2, 40);
for (let i = 0; i < len; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
const wav = `${out}/wait-mode-mic.wav`;
writeFileSync(wav, buf);
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5180/?file=Goose');
await page.waitForFunction(() => window.api?.score && api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 60000 });
await page.keyboard.press('w');
await page.waitForTimeout(500);
await page.keyboard.press('Space');
const stops = new Set();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(800);
  const [state, tick] = await page.evaluate(() => [api.playerState, api.tickPosition]);
  if (state === 0) stops.add(tick);
}
const waited = await page.evaluate(() => Number(document.querySelector('#waitPill .wp-stats b:last-child')?.textContent ?? 0));
const expected = notes.map((t) => t.tick + 1);
const hit = expected.filter((t) => [...stops].some((s) => Math.abs(s - t) <= 2)).length;
console.log(`wait mode: paused on ${hit}/${expected.length} expected notes, ${waited} waited, ${errors.length} page errors`);
await browser.close();
process.exit(hit >= 5 && waited >= 5 && !errors.length ? 0 : 1);

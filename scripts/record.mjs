// Records a demo video of the app with the synthesized audio.
//
//   node scripts/record.mjs <scenario> <out.mp4> [baseUrl]
//
// Video frames come from the Chrome DevTools screencast (each frame is wall-clock stamped);
// audio is tapped inside the page by mirroring every connection to the AudioContext's
// destination into a MediaRecorder. Both use the same clock, so ffmpeg can line them up.
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scenarios } from './scenarios.mjs';

const [name, outArg, base = 'http://127.0.0.1:5180'] = process.argv.slice(2);
const scenario = scenarios[name];
if (!scenario) {
  console.error(`Unknown scenario "${name}". Options: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}
const out = resolve(outArg);
const work = join(dirname(out), `.${name}-frames`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const W = 1440;
const H = 900;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: process.env.SCHEME === 'light' ? 'light' : 'dark' });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  // Headless Chromium resizes the captured frame on real fullscreen; the app's music-stand mode
  // looks the same without it, so recordings skip the browser fullscreen request.
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
  // One capture graph for the whole page: the synth's AudioContext output and any playing
  // <audio>/<video> (embedded backing tracks) are mixed into a single MediaRecorder.
  const cap = { chunks: [], startedAt: 0, recorder: null };
  window.__capture = cap;
  const capCtx = new AudioContext();
  const mix = capCtx.createMediaStreamDestination();
  const attach = (stream) => capCtx.createMediaStreamSource(stream).connect(mix);
  const startRecorder = () => {
    if (cap.recorder) return;
    capCtx.resume();
    const rec = new MediaRecorder(mix.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    rec.ondataavailable = (e) => e.data.size && cap.chunks.push(e.data);
    rec.onstart = () => (cap.startedAt = Date.now());
    rec.start(250);
    cap.recorder = rec;
  };
  window.addEventListener('DOMContentLoaded', startRecorder);

  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && dest.context !== capCtx) {
      const ctx = dest.context;
      if (!ctx.__tap) {
        ctx.__tap = ctx.createMediaStreamDestination();
        attach(ctx.__tap.stream);
      }
      orig.call(this, ctx.__tap);
    }
    return r;
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!this.__tapped) {
      this.__tapped = true;
      try {
        attach(this.captureStream());
      } catch (e) {
        console.warn('media capture failed', e);
      }
    }
    return origPlay.apply(this, args);
  };
});

const frames = [];
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = join(work, `f${String(frames.length).padStart(6, '0')}.jpg`);
  frames.push({ file, t: metadata.timestamp * 1000 });
  writeFileSync(file, Buffer.from(data, 'base64'));
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

await page.goto(`${base}/${scenario.query ?? ''}`);
await page.waitForFunction(() => window.api?.isReadyForPlayback, null, { timeout: 60000 });
await page.waitForTimeout(800);

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
// Demo overlay (recording only): a caption pill and a visible mouse pointer with click ripples.
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = `
    #demo-caption { position: fixed; top: 118px; left: calc(50% + 150px); transform: translateX(-50%); z-index: 9999;
      background: rgba(18,20,24,.92); color: #e8eaed; border: 1px solid #f2a33a; border-radius: 999px; padding: 8px 18px;
      font: 600 15px Inter, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.5); pointer-events: none; transition: opacity .3s; opacity: 0; white-space: nowrap; }
    #demo-cursor { position: fixed; z-index: 10000; width: 18px; height: 18px; margin: -2px 0 0 -2px; pointer-events: none;
      background: no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M2 2l12 5-5 1.6L7 14z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    .demo-ripple { position: fixed; z-index: 9998; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 3px solid #f2a33a; pointer-events: none; animation: demo-rip .5s ease-out forwards; }
    @keyframes demo-rip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`;
  document.head.append(css);
  const cap = Object.assign(document.createElement('div'), { id: 'demo-caption' });
  const cur = Object.assign(document.createElement('div'), { id: 'demo-cursor' });
  cur.style.left = '-50px';
  document.body.append(cap, cur);
  window.addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  window.addEventListener('mousedown', (e) => {
    const r = Object.assign(document.createElement('div'), { className: 'demo-ripple' });
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.append(r); setTimeout(() => r.remove(), 600);
  }, true);
});

const mouse = { x: W / 2, y: H / 2 };
async function moveTo(x, y) {
  await page.mouse.move(x, y, { steps: 18 });
  mouse.x = x;
  mouse.y = y;
}
async function centerOf(sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`not visible: ${sel}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const helpers = {
  page,
  wait: (ms) => page.waitForTimeout(ms),
  key: (k) => page.keyboard.press(k),
  async click(sel) {
    const p = await centerOf(sel);
    await moveTo(p.x, p.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.mouse.up();
  },
  async clickAt(p) {
    await moveTo(p.x, p.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.mouse.up();
  },
  async drag(a, b) {
    await moveTo(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 30 });
    await page.mouse.up();
  },
  caption: (text) =>
    page.evaluate((t) => {
      const c = document.getElementById('demo-caption');
      c.textContent = t ?? '';
      c.style.opacity = t ? '1' : '0';
    }, text),
  // Point inside bar `bar` (0-based), scrolling the sheet so it is visible. fx/fy are fractions of the bar box.
  barPoint: (bar, fx = 0.1, fy = 0.8) =>
    page.evaluate(({ bar, fx, fy }) => {
      const vp = document.getElementById('viewport');
      const host = document.getElementById('alphaTab');
      for (const sys of window.api.boundsLookup.staffSystems)
        for (const mb of sys.bars)
          if (mb.index === bar) {
            const b = mb.visualBounds;
            const vr = vp.getBoundingClientRect();
            let r = host.getBoundingClientRect();
            if (r.top + b.y < vr.top + 40 || r.top + b.y + b.h > vr.bottom - 40) {
              vp.scrollTop += r.top + b.y - vr.top - 140;
              r = host.getBoundingClientRect();
            }
            return { x: r.left + b.x + b.w * fx, y: r.top + b.y + b.h * fy };
          }
      return null;
    }, { bar, fx, fy }),
};
await scenario.run(helpers);
await cdp.send('Page.stopScreencast');

const audio = await page.evaluate(async () => {
  const cap = window.__capture;
  if (!cap.recorder) return null;
  await new Promise((res) => {
    cap.recorder.onstop = res;
    cap.recorder.stop();
  });
  const blob = new Blob(cap.chunks, { type: 'audio/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), startedAt: cap.startedAt };
});
await browser.close();

if (!frames.length) throw new Error('no frames captured');
const t0 = frames[0].t;
const end = frames[frames.length - 1].t + 1000 / 30;
const list = frames
  .map((f, i) => `file '${f.file}'\nduration ${(((frames[i + 1]?.t ?? end) - f.t) / 1000).toFixed(4)}`)
  .join('\n');
writeFileSync(join(work, 'frames.txt'), `${list}\nfile '${frames[frames.length - 1].file}'\n`);

const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt')];
if (audio) {
  const audioFile = join(work, 'audio.webm');
  writeFileSync(audioFile, Buffer.from(audio.b64, 'base64'));
  const offset = (audio.startedAt - t0) / 1000; // seconds of video before the recorder started
  console.log(`frames=${frames.length} audioOffset=${offset.toFixed(3)}s`);
  // Pad (or trim) the audio so it starts exactly at t=0 of the video: players handle that better
  // than a delayed audio stream.
  const lead = offset >= 0 ? `adelay=${Math.round(offset * 1000)}:all=1,` : '';
  if (offset < 0) args.push('-ss', (-offset).toFixed(3));
  args.push('-i', audioFile);
  // The General MIDI sound font is mixed quietly; bring the demo up to a normal listening level.
  args.push('-map', '0:v', '-map', '1:a', '-af', `${lead}loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
} else {
  console.log('warning: no audio captured');
}
args.push('-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', out);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out}`);

// Playback tone: which sound bank the synth uses, and a light "studio" effects chain (room reverb
// + glue compression) between the synth and the speakers. "Basic" is the dry General MIDI sound
// for clean, analytic listening.
//
// alphaTab owns its AudioContext and connects straight to the destination, so we intercept
// connections to the destination and route them through our chain instead.

export type Tone = 'studio' | 'basic';

// Relative to where the app is served from (the site root, or e.g. /tab-trainer/ on GitHub Pages).
export const SOUND_BANKS = {
  studio: `${import.meta.env.BASE_URL}sounds/GeneralUser-GS.sf2`,
  basic: `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`,
} as const;

interface Chain {
  input: GainNode;
  wet: GainNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
}

const chains = new Map<BaseAudioContext, Chain>();
let tone: Tone = 'studio';
const INTERNAL = Symbol('fx-internal');

function impulse(ctx: BaseAudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponentially decaying noise, low-passed progressively so the tail gets darker.
      const k = 0.35 + 0.6 * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < ctx.sampleRate * 0.012 ? 0 : 1);
    }
  }
  return buf;
}

function chainFor(ctx: BaseAudioContext): Chain {
  let c = chains.get(ctx);
  if (c) return c;
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 1.6);
  const wet = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.attack.value = 0.008;
  comp.release.value = 0.2;
  comp.knee.value = 8;
  for (const n of [input, dry, verb, wet, comp, makeup]) (n as unknown as Record<symbol, boolean>)[INTERNAL] = true;
  input.connect(dry).connect(comp);
  input.connect(verb).connect(wet).connect(comp);
  comp.connect(makeup).connect(ctx.destination);
  c = { input, wet, comp, makeup };
  chains.set(ctx, c);
  apply(c);
  return c;
}

function apply(c: Chain) {
  const studio = tone === 'studio';
  const t = c.comp.context.currentTime;
  c.wet.gain.setTargetAtTime(studio ? 0.22 : 0, t, 0.05);
  // ratio 1 = no compression, so "basic" is the untouched synth output.
  c.comp.threshold.setTargetAtTime(studio ? -20 : 0, t, 0.05);
  c.comp.ratio.setTargetAtTime(studio ? 3 : 1, t, 0.05);
  c.makeup.gain.setTargetAtTime(studio ? 1.35 : 1, t, 0.05);
}

/** Route every connection to an AudioContext destination through the tone chain. */
export function installToneRouting() {
  // alphaTab 1.8.4 starts its output source asynchronously, so a very quick play→pause calls
  // stop() before start() and throws, aborting the rest of its pause (the source is left dangling).
  // Stopping a source that never started is a no-op in intent, so swallow exactly that error.
  const stop = AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop = function (this: AudioScheduledSourceNode, when?: number) {
    try {
      stop.call(this, when);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'InvalidStateError')) throw e;
    }
  };
  const orig = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
    if (dest instanceof AudioDestinationNode && !(this as unknown as Record<symbol, boolean>)[INTERNAL]) {
      orig.call(this, chainFor(dest.context).input, ...rest);
      return dest;
    }
    return orig.call(this, dest, ...rest);
  } as typeof AudioNode.prototype.connect;
}

export function setTone(t: Tone) {
  tone = t;
  chains.forEach(apply);
}

/** True when the studio sound bank has been downloaded (`npm run fetch-sounds`). */
export async function studioBankAvailable(): Promise<boolean> {
  try {
    const r = await fetch(SOUND_BANKS.studio, { method: 'HEAD' });
    // Dev servers answer unknown paths with index.html, so check it is really a big binary.
    return r.ok && !(r.headers.get('content-type') ?? '').includes('html') && Number(r.headers.get('content-length') ?? 0) > 1_000_000;
  } catch {
    // Offline: the installed app may still have the bank in its cache.
    return 'caches' in window && !!(await caches.match(SOUND_BANKS.studio).catch(() => null));
  }
}

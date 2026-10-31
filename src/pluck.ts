// Tiny Karplus–Strong plucked-string voice, used when you click a note on the fretboard.
let ctx: AudioContext | null = null;
const cache = new Map<number, AudioBuffer>();

function render(midi: number): AudioBuffer {
  const c = ctx!;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const sr = c.sampleRate;
  const len = Math.floor(sr * 2.5);
  const buf = c.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const period = Math.max(2, Math.round(sr / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  // Low strings ring longer; keep the decay in a pleasant range across the neck.
  const decay = 0.996 + Math.min(0.0035, 40 / freq / 1000);
  let p = 0;
  for (let i = 0; i < len; i++) {
    const next = (p + 1) % period;
    const v = ring[p];
    ring[p] = decay * 0.5 * (ring[p] + ring[next]);
    out[i] = v * 0.5 * Math.min(1, (len - i) / (sr * 0.2));
    p = next;
  }
  return buf;
}

export function pluck(midi: number, volume = 0.8) {
  ctx ??= new AudioContext();
  ctx.resume();
  let buf = cache.get(midi);
  if (!buf) cache.set(midi, (buf = render(midi)));
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

/** Drop the audio engine (e.g. after the browser stalled it); the next pluck starts a fresh one. */
export function resetPluck() {
  ctx?.close().catch(() => {});
  ctx = null;
  cache.clear();
}

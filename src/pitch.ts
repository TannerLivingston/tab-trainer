// Microphone pitch detection (YIN). Monophonic: it reports the strongest single pitch, which is
// what a tuner and a "play this note" check need.

export interface PitchReading {
  /** Frequency in Hz, or 0 when nothing clear is sounding. */
  freq: number;
  /** Fractional MIDI note number (69 = A4), or NaN. */
  midi: number;
  /** 0–1, how periodic the signal is (YIN confidence). */
  clarity: number;
  /** Input level, RMS 0–1. */
  rms: number;
  /**
   * How strongly a given note is sounding, 0–1, whatever else is ringing with it (see `presence`).
   * Absent when the input is silent.
   */
  presence?: (midi: number) => number;
}

const MIN_HZ = 60; // below a 7-string's low B
const MAX_HZ = 1400; // ~24th fret on the high E
const THRESHOLD = 0.12;
/** Below this input level (RMS) nothing is analysed. Low enough for an unplugged electric at arm's length. */
const SILENCE = 0.0015;

export function yin(buf: Float32Array, sampleRate: number): { freq: number; clarity: number; cmnd: Float32Array } {
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), buf.length >> 1);
  const minTau = Math.floor(sampleRate / MAX_HZ);
  const n = buf.length - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < THRESHOLD) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return { freq: 0, clarity: 0, cmnd: d };
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  const a = d[tau - 1] ?? d[tau];
  const b = d[tau];
  const c = d[tau + 1] ?? d[tau];
  const denom = a + c - 2 * b;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return { freq: sampleRate / (tau + shift), clarity: 1 - b, cmnd: d };
}

/**
 * Is this particular note sounding? YIN's single best guess often slips to an octave, a harmonic or
 * another string of a chord; asking "is the signal periodic at this note's period?" is far more
 * forgiving. Checks within ±`tolerance` cents, for a slightly out-of-tune guitar.
 * Returns 0–1 (1 = perfectly periodic there).
 */
export function presence(cmnd: Float32Array, sampleRate: number, midi: number, tolerance = 40) {
  const tau = sampleRate / (440 * Math.pow(2, (midi - 69) / 12));
  const spread = Math.pow(2, tolerance / 1200);
  const lo = Math.max(2, Math.floor(tau / spread));
  const hi = Math.min(cmnd.length - 2, Math.ceil(tau * spread));
  let best = 1;
  for (let t = lo + 1; t < hi; t++) {
    // Only a dip that bottoms out inside the window counts: a neighbouring note's dip spills over
    // the window's edge but keeps falling beyond it.
    if (cmnd[t] < best && cmnd[t] <= cmnd[t - 1] && cmnd[t] <= cmnd[t + 1]) best = cmnd[t];
  }
  return Math.max(0, 1 - best);
}

export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);

/** Listens to the microphone and calls `onReading` ~40 times a second. */
export class PitchListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  running = false;

  constructor(private onReading: (r: PitchReading) => void) {}

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048; // ~43 ms: enough periods for a low B, light enough for phones
    src.connect(analyser); // analysis only: never routed to the speakers
    const buf = new Float32Array(analyser.fftSize);
    this.running = true;
    const rate = this.ctx.sampleRate;
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      if (rms < SILENCE) {
        this.onReading({ freq: 0, midi: NaN, clarity: 0, rms });
        return;
      }
      const { freq, clarity, cmnd } = yin(buf, rate);
      this.onReading({ freq, midi: freq ? freqToMidi(freq) : NaN, clarity, rms, presence: (m) => presence(cmnd, rate, m) });
    }, 25);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = null;
    this.ctx = null;
  }
}

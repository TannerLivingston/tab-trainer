// Wait mode: playback waits at each of your notes until the microphone hears it.
// Notes played on time don't stop the music; late ones pause it until you play them.
import type * as alphaTab from '@coderline/alphatab';
import type { PitchReading } from './pitch';

type Beat = alphaTab.model.Beat;

export interface Target {
  tick: number;
  beat: Beat;
  /** Sounding MIDI pitches you are expected to play (any one of them counts, for chords). */
  pitches: number[];
}

export interface WaitStatus {
  waiting: Target | null;
  next: Target | null;
  inTime: number;
  waited: number;
}

/** How early (ticks; 960 = one quarter note) a played note still counts for the next target. */
const EARLY_WINDOW = 480;
/** `presence` score above which a target note counts as heard, even if the overall pitch guess differs. */
const PRESENT = 0.75;

const samePitchClass = (a: number[], b: number[]) => a.some((x) => b.some((y) => (x - y) % 12 === 0));

export class WaitMode {
  active = false;
  private targets: Target[] = [];
  private idx = 0;
  private waiting = false;
  private expectSnap = false;
  private lastTick = 0;
  private matchFrames = 0;
  private needRelease = false;
  private releaseRms = 0;
  private lastAccepted: number[] = [];
  inTime = 0;
  waited = 0;

  constructor(
    private api: alphaTab.AlphaTabApi,
    private opts: { track: () => number; pitchShift: () => number; onStatus: (s: WaitStatus) => void; setPlaying: (playing: boolean) => void },
  ) {}

  /** Every beat of the focused track that has pitched notes, in playback order (repeats expanded). */
  build() {
    this.targets = [];
    const cache = this.api.tickCache;
    const track = this.opts.track();
    if (!cache) return;
    for (const mb of cache.masterBars) {
      // Time slices of this bar (ticks relative to the bar's start); a beat appears in every slice
      // it spans, so keep it only in the slice where it begins.
      for (let slice = mb.firstBeat; slice; slice = slice === mb.lastBeat ? null : slice.nextBeat) {
        for (const item of slice.highlightedBeats) {
          const beat = item.beat;
          if (beat.voice.bar.staff.track.index !== track || item.playbackStart !== slice.start) continue;
          const pitches = beat.notes.filter((n) => n.fret >= 0 && !n.isDead && !n.isTieDestination).map((n) => n.realValue);
          if (!beat.isRest && pitches.length) this.targets.push({ tick: mb.start + slice.start, beat, pitches });
        }
      }
    }
    this.targets.sort((a, b) => a.tick - b.tick);
    // Several voices can start notes on the same tick: merge them into one target.
    const merged: Target[] = [];
    for (const t of this.targets) {
      const last = merged[merged.length - 1];
      if (last && last.tick === t.tick) last.pitches.push(...t.pitches);
      else merged.push({ ...t, pitches: [...t.pitches] });
    }
    this.targets = merged;
    this.resync(this.api.tickPosition);
  }

  start() {
    this.active = true;
    this.inTime = 0;
    this.waited = 0;
    this.build();
  }

  stop() {
    this.active = false;
    this.waiting = false;
    this.emit();
  }

  private resync(tick: number) {
    this.idx = this.targets.findIndex((t) => t.tick >= tick - 5);
    if (this.idx < 0) this.idx = this.targets.length;
    this.waiting = false;
    this.emit();
  }

  private emit() {
    const t = this.targets[this.idx] ?? null;
    this.opts.onStatus({ waiting: this.active && this.waiting ? t : null, next: this.active ? t : null, inTime: this.inTime, waited: this.waited });
  }

  onPosition(tick: number, playing: boolean, isSeek: boolean) {
    if (!this.active) return;
    const prev = this.lastTick;
    this.lastTick = tick;
    const current = this.targets[this.idx];
    if (this.waiting && current) {
      if (Math.abs(tick - current.tick) <= 5) return;
      // alphaTab's pause snaps the cursor back to the bar start; put it on the note instead.
      if (this.expectSnap && isSeek) {
        this.expectSnap = false;
        setTimeout(() => (this.api.tickPosition = current.tick));
        return;
      }
      // Any other jump while waiting is you seeking elsewhere.
      if (isSeek) return this.resync(tick);
      return;
    }
    // Seeks and loop wraps: pick up from wherever playback now is.
    if (tick < prev - 240 || (current && tick > current.tick + 960)) return this.resync(tick);
    if (!current || !playing) return;
    if (tick >= current.tick) {
      this.waiting = true;
      this.expectSnap = true;
      // Deferred: pausing from inside alphaTab's own position event misbehaves.
      setTimeout(() => this.waiting && this.opts.setPlaying(false));
      this.emit();
    }
  }

  /** What you are expected to play next. */
  get current(): Target | null {
    return this.active ? (this.targets[this.idx] ?? null) : null;
  }

  onPitch(r: PitchReading) {
    if (!this.active) return;
    const target = this.targets[this.idx];
    if (!target) return;
    const heard = r.clarity > 0.85 && !Number.isNaN(r.midi) ? Math.round(r.midi - this.opts.pitchShift()) : null;
    // After accepting a note, wait for it to fade (or a fresh attack) before accepting the same
    // pitch again — otherwise one sustained note would satisfy a run of repeated notes. A different
    // note doesn't need to wait: the last one may still be ringing under it.
    if (this.needRelease && samePitchClass(this.lastAccepted, target.pitches)) {
      if (heard === null || r.rms < this.releaseRms * 0.55) this.needRelease = false;
      else return;
    }
    this.needRelease = false;
    // Octave slips are common in pitch detection; accept the right note in a neighbouring octave.
    // The pitch guess can also lock onto a harmonic or a note still ringing, so also ask directly
    // whether the target is sounding.
    const shift = this.opts.pitchShift();
    const ok =
      (heard !== null && target.pitches.some((p) => (heard - p) % 12 === 0 && Math.abs(heard - p) <= 12)) ||
      (!!r.presence && target.pitches.some((p) => r.presence!(p + shift) >= PRESENT));
    this.matchFrames = ok ? this.matchFrames + 1 : 0;
    if (this.matchFrames < 2) return;
    const early = !this.waiting && this.lastTick >= target.tick - EARLY_WINDOW;
    if (!this.waiting && !early) return;
    this.matchFrames = 0;
    this.needRelease = true;
    this.releaseRms = r.rms;
    this.lastAccepted = target.pitches;
    if (this.waiting) {
      this.waited++;
      this.waiting = false;
      this.idx++;
      this.opts.setPlaying(true);
    } else {
      this.inTime++;
      this.idx++;
    }
    this.emit();
  }
}

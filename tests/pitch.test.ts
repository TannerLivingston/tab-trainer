import { describe, expect, it } from 'vitest';
import { freqToMidi, presence, yin } from '../src/pitch';

const SR = 48000;
function tone(freq: number, n = 2048, harmonics = [1, 0.5, 0.3]) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) harmonics.forEach((a, h) => (buf[i] += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SR)));
  return buf;
}
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('yin', () => {
  it.each([61.74, 82.41, 110, 196, 329.63, 440, 987.77])('detects %f Hz within 3 cents', (f) => {
    const { freq, clarity } = yin(tone(f), SR);
    expect(Math.abs(cents(freq, f))).toBeLessThan(3);
    expect(clarity).toBeGreaterThan(0.8);
  });

  it('reports nothing clear for noise', () => {
    const noise = Float32Array.from({ length: 2048 }, () => Math.random() * 2 - 1);
    const { freq, clarity } = yin(noise, SR);
    expect(freq === 0 || clarity < 0.85).toBe(true);
  });

  it('converts frequencies to MIDI', () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 6);
    expect(freqToMidi(82.41)).toBeCloseTo(40, 2);
  });
});

describe('presence', () => {
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  // A plucked-string-like tone: many harmonics, falling off as 1/h.
  const pluck = (midi: number, detuneCents = 0) => tone(hz(midi) * Math.pow(2, detuneCents / 1200), 2048, Array.from({ length: 12 }, (_, h) => 0.6 / (h + 1)));
  const score = (played: Float32Array, target: number) => presence(yin(played, SR).cmnd, SR, target);

  it.each([40, 45, 52, 59, 64, 71, 76])('finds MIDI %i, also slightly out of tune or an octave up', (m) => {
    expect(score(pluck(m), m)).toBeGreaterThan(0.9);
    expect(score(pluck(m, 30), m)).toBeGreaterThan(0.9);
    expect(score(pluck(m + 12), m)).toBeGreaterThan(0.9);
  });

  it.each([40, 52, 64, 76])('rejects neighbouring notes around MIDI %i', (m) => {
    for (const wrong of [m - 2, m - 1, m + 1, m + 2, m + 5, m + 7, m - 12]) expect(score(pluck(wrong), m)).toBeLessThan(0.5);
  });
});

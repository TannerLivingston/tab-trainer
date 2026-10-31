import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { PRESETS, restore, retab } from '../src/retab';
import { loadScore, notesOf, sampleFiles } from './helpers';

const NATURAL = alphaTab.model.HarmonicType.Natural;

describe.each(sampleFiles())('retab %s', (file) => {
  const sixString = PRESETS.filter((p) => p.tuning.length === 6);
  it.each(sixString.map((p) => p.name))('keeps every pitch for %s', (name) => {
    const score = loadScore(file);
    const track = score.tracks[0];
    const before = [...notesOf(track)].map(({ note }) => ({ note, pitch: note.realValue, string: note.string, fret: note.fret }));
    const result = retab(track, sixString.find((p) => p.name === name)!.tuning);

    const strings = new Map<alphaTab.model.Beat, Set<number>>();
    for (const b of before) {
      const { note } = b;
      if (note.fret < 0) continue;
      expect(note.fret).toBeGreaterThanOrEqual(0);
      expect(note.fret).toBeLessThanOrEqual(24);
      // Distinct strings within a beat.
      const used = strings.get(note.beat) ?? new Set();
      expect(used.has(note.string)).toBe(false);
      used.add(note.string);
      strings.set(note.beat, used);
    }
    const changed = before.filter((b) => b.note.fret >= 0 && b.note.realValue !== b.pitch);
    // Only natural harmonics (pitch tied to the string) and reported octave/unplaced notes may differ.
    const unexplained = changed.filter((b) => b.note.harmonicType !== NATURAL);
    expect(unexplained.length).toBeLessThanOrEqual(result.octaveUp + result.unplaced);

    restore(track);
    for (const b of before) {
      expect(b.note.string).toBe(b.string);
      expect(b.note.fret).toBe(b.fret);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { collectChords, nameChord } from '../src/chords';
import { hasSample, loadScore } from './helpers';

describe('nameChord', () => {
  it.each([
    [[48, 52, 55], 'C'],
    [[45, 52, 57, 60, 64], 'Am'],
    [[40, 47, 52], 'E5'],
    [[43, 47, 50, 53], 'G7'],
    [[45, 52, 55, 60, 64], 'Am7'],
    [[52, 55, 60], 'C/E'],
    [[42, 49, 54, 57, 61, 66], 'F♯m'],
    [[50, 57, 62, 67], 'Dsus4'],
    [[48, 52, 55, 59], 'Cmaj7'],
    [[47, 50, 53], 'Bdim'],
  ])('%j → %s', (pitches, name) => {
    expect(nameChord(pitches)).toBe(name);
  });

  it('returns empty for unrecognised clusters', () => {
    expect(nameChord([60, 61, 62])).toBe('');
  });
});

describe('collectChords', () => {
  it('names the power chords in a demo', () => {
    const names = collectChords(loadScore('Drop D Groove.gp').tracks[0]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['D5', 'F5', 'G5']));
  });

  it.skipIf(!hasSample('3. Goose.gpx'))('derives chord shapes from the tab when the file has no diagrams', () => {
    const chords = collectChords(loadScore('3. Goose.gpx').tracks[0]);
    expect(chords.length).toBeGreaterThan(5);
    for (const c of chords) {
      expect(c.frets).toHaveLength(6);
      expect(c.frets.filter((f) => f >= 0).length).toBeGreaterThanOrEqual(3);
      expect(chords.beatKeys.get(c.first)).toBe(c.key);
    }
  });
});

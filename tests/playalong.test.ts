import { describe, expect, it } from 'vitest';
import { shift, startOnly, syncFromTaps } from '../src/playalong';

describe('sync points', () => {
  it('maps taps onto bars in playback order, counting repeats', () => {
    // Bars 0,1,1,2: bar 1 is repeated.
    const points = syncFromTaps([1000, 2000, 3000, 4000], [0, 1, 1, 2]);
    expect(points).toEqual([
      { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 1000 },
      { barIndex: 1, barOccurence: 0, barPosition: 0, millisecondOffset: 2000 },
      { barIndex: 1, barOccurence: 1, barPosition: 0, millisecondOffset: 3000 },
      { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 4000 },
    ]);
  });

  it('ignores taps beyond the end of the song', () => {
    expect(syncFromTaps([1, 2, 3], [0, 1])).toHaveLength(2);
  });

  it('shifts without going negative', () => {
    expect(shift(startOnly(30), -50)[0].millisecondOffset).toBe(0);
    expect(shift(startOnly(30), 20)[0].millisecondOffset).toBe(50);
  });
});

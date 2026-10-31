import { describe, expect, it } from 'vitest';
import { tuningInfo } from '../src/tuning';
import { hasSample, loadScore } from './helpers';

const withTuning = (tuning: number[]) => {
  const track = loadScore('Greensleeves.gp').tracks[0];
  track.staves[0].stringTuning.tunings = tuning;
  return tuningInfo(track)!;
};

describe('tuningInfo', () => {
  it('reads the demos', () => {
    expect(tuningInfo(loadScore('Greensleeves.gp').tracks[0])).toMatchObject({ isStandard: true, notes: 'E A D G B E', offset: 0 });
    expect(tuningInfo(loadScore('Drop D Groove.gp').tracks[0])!.name).toBe('Drop D');
  });

  it.skipIf(!hasSample('Nonsense.gp'))('reads a whole-neck shift from a sample file', () => {
    const nonsense = tuningInfo(loadScore('Nonsense.gp').tracks[0])!;
    expect(nonsense.name).toBe('F Standard');
    expect(nonsense.notes).toBe('F B♭ E♭ A♭ C F');
    expect(nonsense.offset).toBe(1);
  });

  it('names whole-neck shifts and drop tunings', () => {
    expect(withTuning([63, 58, 54, 49, 44, 39])).toMatchObject({ offset: -1 });
    expect(withTuning([63, 58, 54, 49, 44, 39]).name).toBe('E♭ Standard');
    expect(withTuning([62, 57, 53, 48, 43, 38]).offset).toBe(-2);
    expect(withTuning([64, 59, 55, 50, 45, 38]).name).toBe('Drop D');
    expect(withTuning([64, 59, 55, 50, 45, 40]).name).toBe('Standard');
    // Drop tunings can't be matched by a global pitch shift.
    expect(withTuning([63, 58, 54, 49, 44, 37]).offset).toBeNull();
  });

  it('spells out octaves when names alone would look standard', () => {
    const nashville = withTuning([64, 59, 67, 62, 57, 52]);
    expect(nashville.name).toBe('Nashville (high-strung)');
    expect(nashville.notes).toBe('E3 A3 D4 G4 B3 E4');
  });

  it('leaves genuinely custom tunings as custom', () => {
    expect(withTuning([62, 57, 55, 50, 45, 38]).isStandard).toBe(false); // DADGAD
    expect(withTuning([65, 60, 55, 50, 45, 40]).offset).toBeNull();
  });
});

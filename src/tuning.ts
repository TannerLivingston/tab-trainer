import * as alphaTab from '@coderline/alphatab';

type Track = alphaTab.model.Track;

// Reference tunings, highest string first (alphaTab's order).
const STANDARD: Record<number, number[]> = {
  4: [43, 38, 33, 28],
  5: [43, 38, 33, 28, 23],
  6: [64, 59, 55, 50, 45, 40],
  7: [64, 59, 55, 50, 45, 40, 35],
  8: [64, 59, 55, 50, 45, 40, 35, 30],
};

/** Pretty note name: Eb → E♭, F# → F♯. */
export const pretty = (s: string) => s.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');
export const noteName = (midi: number) => pretty(alphaTab.model.Tuning.getTextForTuning(midi, false));

export interface TuningInfo {
  name: string;
  isStandard: boolean;
  /** Low → high, e.g. "D A D G B E". */
  notes: string;
  capo: number;
  /**
   * Semitones between this tuning and standard on the upper strings (e.g. −1 for E♭ standard,
   * +1 for F standard), or null when the tuning is not a whole-neck shift of standard.
   * Playing the same frets on a standard-tuned guitar sounds `offset` semitones off.
   */
  offset: number | null;
}

export function tuningInfo(track: Track): TuningInfo | null {
  const staff = track.staves[0];
  if (!staff || staff.isPercussion || !staff.isStringed || staff.tuning.length === 0) return null;
  const tuning = staff.tuning;
  const preset = alphaTab.model.Tuning.findTuning(tuning);
  const std = STANDARD[tuning.length];
  let offset: number | null = null;
  let derived = '';
  if (std) {
    const diffs = tuning.map((t, i) => t - std[i]);
    const upper = diffs.slice(0, -1);
    const lowest = diffs[diffs.length - 1];
    if (upper.every((d) => d === upper[0])) {
      offset = upper[0];
      const root = noteName(tuning[tuning.length - 2] - 5); // what the lowest string "should" be
      if (lowest === offset && offset !== 0) derived = `${root} Standard`;
      else if (lowest === offset - 2) {
        derived = `Drop ${noteName(tuning[tuning.length - 1])}`;
        offset = null; // the low string can't be matched by a global pitch shift
      } else if (lowest !== offset) offset = null;
    }
  }
  const isStandard = preset?.isStandard ?? (offset === 0 && !derived);
  // alphaTab's preset names are wordy ("Guitar Dropped D Tuning"); trim them to what players say.
  const presetName =
    preset && !/custom/i.test(preset.name)
      ? preset.name
          .replace(/^(guitar|bass)\s+/i, '')
          .replace(/\s+tuning$/i, '')
          .replace(/^dropped\s+/i, 'Drop ')
          .replace(/^standard$/i, 'Standard')
      : '';
  let notes = [...tuning].reverse().map(noteName).join(' ');
  if (!isStandard && std && notes === [...std].reverse().map(noteName).join(' ')) {
    // Same note names as standard but different octaves (e.g. Nashville): the names alone would
    // read as standard, so spell out the octaves.
    notes = [...tuning].reverse().map((m) => pretty(alphaTab.model.Tuning.getTextForTuning(m, true))).join(' ');
    // Nashville / high-strung: top strings as standard, lower strings raised by whole octaves.
    const diffs = tuning.map((t, i) => t - std[i]);
    if (diffs.length === 6 && diffs[0] === 0 && diffs[1] === 0 && diffs.slice(2).every((d) => d > 0 && d % 12 === 0)) derived = 'Nashville (high-strung)';
  }
  return {
    // Derived names ("E♭ Standard", "Drop C♯") are the clearest, so they win over presets.
    name: derived || presetName || (isStandard ? 'Standard' : 'Custom tuning'),
    isStandard,
    notes,
    capo: staff.capo,
    offset,
  };
}

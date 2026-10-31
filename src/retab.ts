// Re-tab a track for a different tuning: every note keeps its pitch but moves to a string/fret
// that exists in the target tuning, so e.g. an E♭-standard tab can be read on a standard guitar.
import * as alphaTab from '@coderline/alphatab';

type Track = alphaTab.model.Track;
type Note = alphaTab.model.Note;

export interface TuningPreset {
  name: string;
  /** Highest string first (alphaTab's order). */
  tuning: number[];
}

export const PRESETS: TuningPreset[] = [
  { name: 'Standard (E)', tuning: [64, 59, 55, 50, 45, 40] },
  { name: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
  { name: 'E♭ Standard', tuning: [63, 58, 54, 49, 44, 39] },
  { name: 'D Standard', tuning: [62, 57, 53, 48, 43, 38] },
  { name: 'Drop C♯', tuning: [63, 58, 54, 49, 44, 37] },
  { name: 'Drop C', tuning: [62, 57, 53, 48, 43, 36] },
  { name: 'DADGAD', tuning: [62, 57, 55, 50, 45, 38] },
  { name: 'Open G', tuning: [62, 59, 55, 50, 43, 38] },
  { name: 'Open D', tuning: [62, 57, 54, 50, 45, 38] },
  { name: '7-string Standard (B)', tuning: [64, 59, 55, 50, 45, 40, 35] },
  { name: '7-string Drop A', tuning: [64, 59, 55, 50, 45, 40, 33] },
  { name: 'Bass Standard (E)', tuning: [43, 38, 33, 28] },
  { name: 'Bass Drop D', tuning: [43, 38, 33, 26] },
  { name: '5-string Bass (B)', tuning: [43, 38, 33, 28, 23] },
];

interface Original {
  tuning: number[];
  notes: Map<Note, { string: number; fret: number }>;
}
const originals = new WeakMap<Track, Original>();

export const isRetabbed = (track: Track) => originals.has(track);
export const originalTuning = (track: Track) => originals.get(track)?.tuning ?? track.staves[0].tuning;

export interface RetabResult {
  moved: number;
  octaveUp: number;
  harmonicsChanged: number;
  /** Notes with no free string in the target tuning (left where they were). */
  unplaced: number;
}

const MAX_FRET = 24;
const HT = alphaTab.model.HarmonicType;

/** Move every note of `track` onto `target` (same string count), keeping pitches. */
export function retab(track: Track, target: number[]): RetabResult {
  restore(track);
  const staff = track.staves[0];
  const orig: Original = { tuning: [...staff.tuning], notes: new Map() };
  const from = orig.tuning;
  const n = from.length;
  const result: RetabResult = { moved: 0, octaveUp: 0, harmonicsChanged: 0, unplaced: 0 };
  let hand = 5; // rough fretting-hand position, so shapes stay compact

  for (const st of track.staves)
    for (const bar of st.bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats) {
          const notes = beat.notes.filter((x) => x.isStringed && x.string >= 1 && x.fret >= 0);
          if (!notes.length) continue;
          const used = new Set<number>();
          const options = (pitch: number) =>
            target.map((open, i) => ({ i, fret: pitch - open })).filter((o) => o.fret >= 0 && o.fret <= MAX_FRET && !used.has(o.i));
          // Fingered pitch (open string + fret, ignoring capo/harmonics). Place the most constrained
          // notes first (fewest possible strings, then lowest) so a chord's low note isn't crowded out.
          const items = notes
            .map((note) => ({ note, idx: n - note.string, pitch: from[n - note.string] + note.fret }))
            .map((it) => ({ ...it, choices: options(it.pitch).length || 99 }))
            .sort((a, b) => a.choices - b.choices || a.pitch - b.pitch);
          const placed: number[] = [];
          for (const it of items) {
            orig.notes.set(it.note, { string: it.note.string, fret: it.note.fret });
            const natural = it.note.harmonicType === HT.Natural;
            let opts = options(it.pitch);
            if (!opts.length) {
              // Below the target's range: play it an octave up rather than lose it.
              opts = options(it.pitch + 12);
              if (opts.length) result.octaveUp++;
            }
            if (!opts.length) {
              result.unplaced++;
              continue;
            }
            // Prefer the same string (natural harmonics need it), then frets near the hand.
            const cost = (o: { i: number; fret: number }) =>
              (o.i === it.idx ? -1.5 : 0) + Math.abs((o.fret || hand) - hand) * 0.6 + (o.fret === 0 ? 0.5 : 0);
            const same = opts.find((o) => o.i === it.idx);
            const best = natural && same ? same : opts.sort((a, b) => cost(a) - cost(b))[0];
            if (natural && best.fret !== it.note.fret) result.harmonicsChanged++;
            used.add(best.i);
            if (best.i !== it.idx || best.fret !== it.note.fret) result.moved++;
            it.note.string = n - best.i;
            it.note.fret = best.fret;
            if (best.fret > 0) placed.push(best.fret);
          }
          if (placed.length) hand = hand * 0.5 + (placed.reduce((a, b) => a + b, 0) / placed.length) * 0.5;
        }

  for (const st of track.staves) st.stringTuning.tunings = [...target];
  originals.set(track, orig);
  return result;
}

/** Put a re-tabbed track back exactly as written. */
export function restore(track: Track) {
  const orig = originals.get(track);
  if (!orig) return;
  for (const [note, pos] of orig.notes) {
    note.string = pos.string;
    note.fret = pos.fret;
  }
  for (const st of track.staves) st.stringTuning.tunings = [...orig.tuning];
  originals.delete(track);
}

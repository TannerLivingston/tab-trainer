// Chord sheet: the chord shapes a track uses, drawn as diagrams. Uses the chord diagrams stored
// in the file when there are any; otherwise derives shapes from the tab itself (beats with three or
// more fretted notes) and names them with a small chord recogniser.
import type * as alphaTab from '@coderline/alphatab';
import { pretty } from './tuning';

type Track = alphaTab.model.Track;
type Beat = alphaTab.model.Beat;

export interface ChordShape {
  key: string;
  name: string;
  /** Fret per string, highest string first; -1 = not played. */
  frets: number[];
  barre: number[];
  /** MIDI pitch of each sounding string (same order as frets), for auditioning. */
  pitches: number[];
  first: Beat;
  count: number;
  fromFile: boolean;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Interval sets (semitones above the root) → suffix. Order matters: earlier wins on ties.
const QUALITIES: [number[], string][] = [
  [[0, 4, 7], ''],
  [[0, 3, 7], 'm'],
  [[0, 7], '5'],
  [[0, 4, 7, 10], '7'],
  [[0, 4, 7, 11], 'maj7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 2, 7], 'sus2'],
  [[0, 5, 7], 'sus4'],
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
  [[0, 2, 4, 7], 'add9'],
  [[0, 2, 3, 7], 'm(add9)'],
  [[0, 2, 4, 7, 10], '9'],
  [[0, 2, 3, 7, 10], 'm9'],
  [[0, 2, 4, 7, 11], 'maj9'],
  [[0, 5, 7, 10], '7sus4'],
  [[0, 3, 6], 'dim'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 3, 6, 10], 'm7♭5'],
  [[0, 4, 8], 'aug'],
  [[0, 3, 7, 11], 'm(maj7)'],
  // Common voicings that leave out the fifth.
  [[0, 4, 10], '7'],
  [[0, 3, 10], 'm7'],
  [[0, 4, 11], 'maj7'],
  [[0, 7, 10], '7(no3)'],
  [[0, 5, 10], '7sus4'],
];

export function nameChord(pitches: number[]): string {
  if (!pitches.length) return '';
  const bass = Math.min(...pitches) % 12;
  const pcs = [...new Set(pitches.map((p) => p % 12))];
  let best: { root: number; suffix: string; score: number } | null = null;
  for (const root of pcs) {
    const set = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b).join();
    QUALITIES.forEach(([ints, suffix], i) => {
      if (ints.join() !== set) return;
      const score = (root === bass ? 100 : 0) - i;
      if (!best || score > best.score) best = { root, suffix, score };
    });
  }
  if (!best) return '';
  const b = best as { root: number; suffix: string };
  const name = NAMES[b.root] + b.suffix;
  return pretty(b.root === bass ? name : `${name}/${NAMES[bass]}`);
}

export function collectChords(track: Track): ChordList {
  const staff = track.staves[0];
  if (!staff || staff.isPercussion || !staff.isStringed) return Object.assign([], { beatKeys: new Map() }) as ChordList;
  const n = staff.tuning.length;
  const byKey = new Map<string, ChordShape>();
  const beatKeys = new Map<Beat, string>();
  const order: string[] = [];
  const add = (beat: Beat, shape: Omit<ChordShape, 'first' | 'count' | 'key'>, key: string) => {
    beatKeys.set(beat, key);
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    byKey.set(key, { ...shape, key, first: beat, count: 1 });
    order.push(key);
  };

  // 1. Chord diagrams stored in the file.
  for (const bar of staff.bars)
    for (const voice of bar.voices)
      for (const beat of voice.beats) {
        const c = beat.chord;
        if (!c || !c.strings?.length) continue;
        const frets = Array.from({ length: n }, (_, i) => (c.strings[i] ?? -1));
        const pitches = frets.map((f, i) => (f >= 0 ? staff.tuning[i] + f + staff.capo : -1));
        const name = c.name ? pretty(c.name) : nameChord(pitches.filter((p) => p >= 0));
        add(beat, { name, frets, barre: c.barreFrets ?? [], pitches, fromFile: true }, `file:${c.name}|${frets.join()}`);
      }
  if (byKey.size) return finish();

  // 2. Shapes derived from the tab.
  for (const bar of staff.bars)
    for (const voice of bar.voices)
      for (const beat of voice.beats) {
        const notes = beat.notes.filter((x) => x.fret >= 0 && x.string >= 1 && !x.isDead);
        if (notes.length < 3 || notes.every((x) => x.isTieDestination)) continue;
        const frets = new Array(n).fill(-1);
        const pitches = new Array(n).fill(-1);
        for (const x of notes) {
          frets[n - x.string] = x.fret;
          pitches[n - x.string] = x.realValue;
        }
        add(beat, { name: nameChord(pitches.filter((p) => p >= 0)), frets, barre: [], pitches, fromFile: false }, `tab:${frets.join()}`);
      }
  return finish();

  function finish() {
    const list = order.map((k) => byKey.get(k)!);
    // Keep the sheet readable for riff-heavy songs: the 40 most-used shapes, in song order.
    if (list.length > 40) {
      const keep = new Set([...list].sort((a, b) => b.count - a.count).slice(0, 40).map((c) => c.key));
      return Object.assign(list.filter((c) => keep.has(c.key)), { beatKeys }) as ChordList;
    }
    return Object.assign(list, { beatKeys }) as ChordList;
  }
}

export type ChordList = ChordShape[] & { beatKeys: Map<Beat, string> };

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Classic chord-box diagram: strings vertical (low string on the left), frets horizontal. */
export function chordDiagram(shape: ChordShape): SVGSVGElement {
  const lowToHigh = [...shape.frets].reverse();
  const n = lowToHigh.length;
  const played = lowToHigh.filter((f) => f > 0);
  const maxFret = played.length ? Math.max(...played) : 0;
  const minFret = played.length ? Math.min(...played) : 0;
  const base = maxFret <= 4 ? 1 : minFret;
  const rows = Math.max(4, Math.min(5, maxFret - base + 1));
  const W = 76;
  const left = 14;
  const top = 18;
  const sx = (W - left - 8) / (n - 1);
  const sy = 13;
  const svg = el('svg', { viewBox: `0 0 ${W} ${top + rows * sy + 8}`, class: 'chord-svg' }) as SVGSVGElement;
  for (let r = 0; r <= rows; r++) svg.append(el('line', { x1: left, x2: left + (n - 1) * sx, y1: top + r * sy, y2: top + r * sy, class: 'cd-fret' }));
  for (let s = 0; s < n; s++) svg.append(el('line', { x1: left + s * sx, x2: left + s * sx, y1: top, y2: top + rows * sy, class: 'cd-string' }));
  if (base === 1) svg.append(el('rect', { x: left - 1, y: top - 3, width: (n - 1) * sx + 2, height: 3.5, class: 'cd-nut' }));
  else {
    const t = el('text', { x: left - 4, y: top + sy * 0.5 + 3.5, 'text-anchor': 'end', class: 'cd-base' });
    t.textContent = String(base);
    svg.append(t);
  }
  for (const b of shape.barre) {
    if (b <= 0) continue;
    const strings = lowToHigh.map((f, i) => (f === b ? i : -1)).filter((i) => i >= 0);
    if (strings.length < 2) continue;
    const y = top + (b - base + 0.5) * sy;
    svg.append(el('rect', { x: left + strings[0] * sx - 4.5, y: y - 4.5, width: (strings[strings.length - 1] - strings[0]) * sx + 9, height: 9, rx: 4.5, class: 'cd-dot' }));
  }
  lowToHigh.forEach((f, s) => {
    const x = left + s * sx;
    if (f < 0 || f === 0) {
      const t = el('text', { x, y: top - 6, 'text-anchor': 'middle', class: 'cd-open' });
      t.textContent = f < 0 ? '×' : '○';
      svg.append(t);
      return;
    }
    if (f - base >= rows) return;
    svg.append(el('circle', { cx: x, cy: top + (f - base + 0.5) * sy, r: 4.6, class: 'cd-dot' }));
  });
  return svg;
}

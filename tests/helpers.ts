import * as alphaTab from '@coderline/alphatab';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Tests run against the bundled demos, plus your own /samples folder when it's there (it is kept
// out of git, so a fresh clone has only the demos).
export const DEMOS_DIR = join(__dirname, '..', 'demos');
export const SAMPLES_DIR = join(__dirname, '..', 'samples');
const songsIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.(gp|gpx|gp3|gp4|gp5)$/i.test(f)) : []);
export const sampleFiles = () => [...songsIn(DEMOS_DIR), ...songsIn(SAMPLES_DIR)];
export const hasSample = (file: string) => existsSync(join(SAMPLES_DIR, file));

export function loadScore(file: string): alphaTab.model.Score {
  const path = existsSync(join(DEMOS_DIR, file)) ? join(DEMOS_DIR, file) : join(SAMPLES_DIR, file);
  const bytes = new Uint8Array(readFileSync(path));
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
}

export function* notesOf(track: alphaTab.model.Track) {
  for (const staff of track.staves)
    for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) for (const note of beat.notes) yield { beat, note };
}

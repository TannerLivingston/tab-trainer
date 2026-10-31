// Builds the bundled demo songs: demos/src/*.atex (alphaTex text) → demos/*.gp (Guitar Pro 7).
// Every demo is a public-domain melody or an original exercise, arranged for this project and
// dedicated to the public domain, so the app can ship them. Run with `npm run demos`.
//
// Checks: each file parses, every bar adds up to its time signature, and the written .gp file
// reads back with the same notes.
import * as alphaTab from '@coderline/alphatab';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'demos');
const QUARTER = 960; // alphaTab ticks per quarter note
let failed = false;

const notes = (score) =>
  score.tracks.map((t) => t.staves[0].bars.flatMap((b) => b.voices[0].beats.flatMap((beat) => beat.notes.map((n) => `${n.fret}/${n.string}`))).join(' '));

for (const file of readdirSync(join(dir, 'src')).filter((f) => f.endsWith('.atex')).sort()) {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(readFileSync(join(dir, 'src', file), 'utf8'), settings);
  let score;
  try {
    score = importer.readScore();
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
    failed = true;
    continue;
  }

  // Bars must be full (the first may be a pickup: it only has to fit).
  for (const track of score.tracks) {
    for (const bar of track.staves[0].bars) {
      const mb = bar.masterBar;
      const expected = (QUARTER * 4 * mb.timeSignatureNumerator) / mb.timeSignatureDenominator;
      const actual = bar.voices[0].beats.reduce((sum, b) => sum + b.playbackDuration, 0);
      if (actual !== expected) {
        console.error(`✗ ${file}: track "${track.name}" bar ${bar.index + 1} lasts ${actual / QUARTER} beats, expected ${expected / QUARTER}`);
        failed = true;
      }
    }
  }

  const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings);
  const out = join(dir, `${score.title}.gp`); // the file name is what the Songs list shows
  writeFileSync(out, bytes);
  const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(out)), new alphaTab.Settings());
  if (JSON.stringify(notes(back)) !== JSON.stringify(notes(score))) {
    console.error(`✗ ${file}: the written .gp file reads back differently`);
    failed = true;
  }
  const bars = score.masterBars.length;
  console.log(`✓ ${basename(out)}: "${score.title}" · ${score.tracks.map((t) => t.name).join(', ')} · ${bars} bars · ${(bytes.length / 1024).toFixed(1)} KB`);
}
process.exit(failed ? 1 : 0);

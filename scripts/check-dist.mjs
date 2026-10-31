// Guard run before publishing: the only songs allowed in the build are the bundled demos
// (public-domain melodies and original exercises, built from demos/src). Fails if any other
// Guitar Pro file, or anything from the local /samples folder, made it into dist/.
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, process.argv[2] ?? 'dist');
const demos = new Set(readdirSync(join(root, 'demos')).filter((f) => f.endsWith('.gp')).map((f) => f.replace(/\.gp$/, '')));
const SONG = /\.(gp|gpx|gp3|gp4|gp5|gp7|gp8|ptb|tg)$/i;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);

const songs = files.filter((f) => SONG.test(f));
// Vite names built assets "<original name>-<hash>.<ext>".
const unexpected = songs.filter((f) => !demos.has(basename(f).replace(SONG, '').replace(/-[\w-]{8}$/, '')));
const fromSamples = files.filter((f) => f.includes(`${join('dist', 'samples')}`));

if (unexpected.length || fromSamples.length) {
  console.error('✗ The build contains songs that are not approved demos:');
  for (const f of [...unexpected, ...fromSamples]) console.error('  ' + f.slice(root.length + 1));
  process.exit(1);
}
console.log(`✓ Only approved demo songs in the build (${songs.length}): ${songs.map((f) => basename(f)).join(', ')}`);

// Downloads the latest "Studio" sound bank, GeneralUser GS by S. Christian Collins — free for use
// in software (see its LICENSE.txt). The author asks for a local copy rather than hot-linking, so
// the bank is committed in public/sounds/; run this to upgrade it, then commit the new files.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/';
const dir = new URL('../public/sounds/', import.meta.url);

mkdirSync(dir, { recursive: true });
for (const [from, file] of [['documentation/LICENSE.txt', 'GeneralUser-GS-LICENSE.txt'], ['GeneralUser-GS.sf2', 'GeneralUser-GS.sf2']]) {
  const res = await fetch(BASE + from);
  if (!res.ok) throw new Error(`${res.status} fetching ${BASE + from}`);
  const tmp = new URL(`${file}.part`, dir);
  const target = new URL(file, dir);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const changed = !existsSync(target) || !readFileSync(tmp).equals(readFileSync(target));
  renameSync(tmp, target);
  console.log(`${changed ? 'updated' : 'unchanged'}: public/sounds/${file} (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
}

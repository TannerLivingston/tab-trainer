// Downloads the high-quality sound bank used by the "Studio" tone.
// GeneralUser GS by S. Christian Collins — free for use in software (see its LICENSE.txt);
// the author asks for a local copy rather than hot-linking, so we keep one in public/sounds/.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const URL_SF2 = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2';
const URL_LICENSE = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt';
const dir = new URL('../public/sounds/', import.meta.url);
const target = new URL('GeneralUser-GS.sf2', dir);

mkdirSync(dir, { recursive: true });
if (existsSync(target) && statSync(target).size > 1_000_000) {
  console.log('Sound bank already present.');
  process.exit(0);
}
for (const [url, file] of [[URL_LICENSE, 'GeneralUser-GS-LICENSE.txt'], [URL_SF2, 'GeneralUser-GS.sf2']]) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const tmp = new URL(`${file}.part`, dir);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, new URL(file, dir));
  console.log(`saved public/sounds/${file} (${(statSync(new URL(file, dir)).size / 1e6).toFixed(1)} MB)`);
}

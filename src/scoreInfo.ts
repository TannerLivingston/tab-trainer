/**
 * Some exporters pack metadata into the title ("artist=Funky Guy,title=Steady,style=Funk").
 * Unpack it so the header, library and engraved title read properly.
 */
export function unpackTitle(score: { title: string; artist: string }) {
  if (!/^\s*\w+\s*=/.test(score.title)) return;
  const kv = Object.fromEntries(
    score.title
      .split(',')
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter((p) => p.length === 2 && p[0]),
  ) as Record<string, string>;
  if (!kv.title) return;
  score.title = kv.title;
  if (kv.artist && !score.artist) score.artist = kv.artist;
}

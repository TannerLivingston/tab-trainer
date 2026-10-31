import { describe, expect, it } from 'vitest';
import { unpackTitle } from '../src/scoreInfo';

describe('unpackTitle', () => {
  it('unpacks key=value titles', () => {
    const s = { title: 'artist=Funky Guy,title=Steady,difficulty=2,style=Funk', artist: '' };
    unpackTitle(s);
    expect(s).toEqual({ title: 'Steady', artist: 'Funky Guy' });
  });
  it('keeps an existing artist', () => {
    const s = { title: 'title=Steady,artist=Someone', artist: 'Real Artist' };
    unpackTitle(s);
    expect(s).toEqual({ title: 'Steady', artist: 'Real Artist' });
  });
  it('leaves normal titles alone', () => {
    for (const title of ['Goose', 'LET THERE BE LIGHT', 'a=b but no title', 'Song, with = signs']) {
      const s = { title, artist: '' };
      unpackTitle(s);
      expect(s.title).toBe(title);
    }
  });
});

// Play along with your own recording: attach an audio file to the song, line it up with the tab
// via sync points (tap along on each bar's first beat, then nudge), and keep it per song.
import * as alphaTab from '@coderline/alphatab';

type Score = alphaTab.model.Score;
type FlatSyncPoint = { barIndex: number; barOccurence: number; barPosition: number; millisecondOffset: number };

export interface Recording {
  key: string;
  name: string;
  bytes: Uint8Array;
  sync: FlatSyncPoint[];
}

// ---------------------------------------------------------------------------
// Storage (IndexedDB; recordings are megabytes)
// ---------------------------------------------------------------------------

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('woodshed-recordings', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function loadRecording(key: string): Promise<Recording | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction('recordings').objectStore('recordings').get(key);
      req.onsuccess = () => resolve((req.result as Recording) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
export async function saveRecording(rec: Recording) {
  try {
    (await db()).transaction('recordings', 'readwrite').objectStore('recordings').put(rec);
  } catch {
    /* storage unavailable: the recording works for this session only */
  }
}
export async function deleteRecording(key: string) {
  try {
    (await db()).transaction('recordings', 'readwrite').objectStore('recordings').delete(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Attaching to the score
// ---------------------------------------------------------------------------

/** What the file itself shipped with (GP8 embedded audio), so removing a recording restores it. */
export interface Original {
  backing: alphaTab.model.BackingTrack | undefined;
  sync: FlatSyncPoint[];
}
export function captureOriginal(score: Score): Original {
  return { backing: score.backingTrack, sync: score.exportFlatSyncPoints() };
}

export function attach(score: Score, rec: Pick<Recording, 'bytes' | 'sync'>) {
  const bt = new alphaTab.model.BackingTrack();
  bt.rawAudioFile = rec.bytes;
  score.backingTrack = bt;
  score.applyFlatSyncPoints(rec.sync);
}
export function detach(score: Score, original: Original) {
  score.backingTrack = original.backing;
  score.applyFlatSyncPoints(original.sync);
}

/** A single sync point: bar 1 starts `ms` into the recording; the score's tempo does the rest. */
export const startOnly = (ms: number): FlatSyncPoint[] => [{ barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: Math.max(0, ms) }];

/**
 * Turn taps (recording times of successive bar downbeats, in playback order) into sync points.
 * `order` is the playback order of master bars (repeats expanded), from the tick cache.
 */
export function syncFromTaps(taps: number[], order: number[]): FlatSyncPoint[] {
  const seen = new Map<number, number>();
  return taps.slice(0, order.length).map((ms, i) => {
    const bar = order[i];
    const occurrence = seen.get(bar) ?? 0;
    seen.set(bar, occurrence + 1);
    return { barIndex: bar, barOccurence: occurrence, barPosition: 0, millisecondOffset: Math.max(0, Math.round(ms)) };
  });
}

export const shift = (sync: FlatSyncPoint[], ms: number) => sync.map((p) => ({ ...p, millisecondOffset: Math.max(0, p.millisecondOffset + ms) }));

export function describeSync(sync: FlatSyncPoint[]) {
  if (!sync.length) return 'not synced';
  const first = (sync[0].millisecondOffset / 1000).toFixed(2);
  return sync.length === 1 ? `bar 1 at ${first}s, follows the score's tempo` : `${sync.length} bars tapped, bar 1 at ${first}s`;
}

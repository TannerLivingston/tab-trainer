import type { BarNote } from './notes';

// Persistence: app preferences and per-song practice state (localStorage), plus recently opened
// files (IndexedDB, since the bytes are needed to reopen them).

export interface Prefs {
  zoom: number;
  view: 'default' | 'tab' | 'score';
  layout: 'page' | 'horizontal';
  theme: 'paper' | 'sepia' | 'night';
  fretboard: boolean;
  fbLabels: 'notes' | 'frets';
  lefty: boolean;
  overview: boolean;
  volume: number;
  metronome: boolean;
  countIn: boolean;
  sidebar: boolean;
  tone: 'studio' | 'basic';
  chords: boolean;
  follow: boolean;
  appTheme: 'auto' | 'dark' | 'light';
  seenTips: boolean;
  dailyGoal: number;
  pedals: { left: PedalBinding; right: PedalBinding };
}

export type PedalAction = 'none' | 'playpause' | 'restart' | 'prev' | 'next' | 'loop' | 'nextchunk' | 'slower' | 'faster';
export interface PedalBinding {
  key: string;
  action: PedalAction;
}

export interface SavedLoop {
  start: number;
  end: number;
  name: string;
}

export interface SongState {
  speed: number;
  pitch: number;
  visible: number[];
  mixer: Record<number, { mute: boolean; solo: boolean; vol: number }>;
  loop: { start: number; end: number } | null;
  bar: number;
  loops: SavedLoop[];
  notes: BarNote[];
  /** track index → tuning the tab was rewritten for */
  retab: Record<number, number[]>;
  /** Section marks you added (bar → name). */
  sections: { bar: number; name: string }[];
}

const PREFS_KEY = 'woodshed.prefs';
const DEFAULT_PREFS: Prefs = {
  zoom: 100,
  view: 'default',
  layout: 'page',
  theme: 'paper',
  fretboard: false,
  fbLabels: 'notes',
  lefty: false,
  overview: true,
  volume: 80,
  metronome: false,
  countIn: false,
  sidebar: true,
  tone: 'studio',
  chords: false,
  follow: true,
  appTheme: 'auto',
  seenTips: false,
  dailyGoal: 20,
  // Most Bluetooth page-turner pedals send PageUp / PageDown.
  pedals: { left: { key: 'PageUp', action: 'restart' }, right: { key: 'PageDown', action: 'playpause' } },
};

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}
/** Set after a restore: the page is about to reload, so nothing may overwrite the restored data. */
let frozen = false;
export const storageFrozen = () => frozen;

function write(key: string, value: unknown) {
  if (frozen) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota): preferences just won't stick */
  }
}

export function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...(read<Prefs>(PREFS_KEY) ?? {}) };
}
export function savePrefs(p: Prefs) {
  write(PREFS_KEY, p);
}

export const songKey = (parts: (string | number)[]) => `woodshed.song.${parts.join('|')}`;
export function loadSong(key: string): Partial<SongState> | null {
  return read<SongState>(key);
}
let songTimer = 0;
export function saveSong(key: string, s: SongState) {
  clearTimeout(songTimer);
  songTimer = window.setTimeout(() => write(key, s), 300);
}

// ---------------------------------------------------------------------------
// Recent files
// ---------------------------------------------------------------------------

export interface RecentFile {
  name: string;
  bytes: Uint8Array;
  openedAt: number;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('woodshed', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addRecent(name: string, bytes: Uint8Array) {
  try {
    const d = await db();
    const all = await listRecent();
    const tx = d.transaction('recent', 'readwrite');
    const store = tx.objectStore('recent');
    store.put({ name, bytes, openedAt: Date.now() });
    for (const old of all.filter((r) => r.name !== name).slice(7)) store.delete(old.name);
  } catch {
    /* IndexedDB unavailable */
  }
}

export async function listRecent(): Promise<RecentFile[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const req = d.transaction('recent').objectStore('recent').getAll();
      req.onsuccess = () => resolve((req.result as RecentFile[]).sort((a, b) => b.openedAt - a.openedAt));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Song metadata, remembered per file name so the library can show real titles
// ---------------------------------------------------------------------------

export interface SongMeta {
  title: string;
  artist: string;
  tracks: number;
  bars: number;
  /** Key used by the practice log and per-song state. */
  key: string;
}
const META_KEY = 'woodshed.meta';
export function loadMeta(): Record<string, SongMeta> {
  return (read<Record<string, SongMeta>>(META_KEY) ?? {}) as Record<string, SongMeta>;
}
export function saveMeta(file: string, meta: SongMeta) {
  write(META_KEY, { ...loadMeta(), [file]: meta });
}

// ---------------------------------------------------------------------------
// Backup / restore of everything kept in localStorage (prefs, per-song state, practice log)
// ---------------------------------------------------------------------------

export interface Backup {
  app: 'woodshed';
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export function makeBackup(): Backup {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('woodshed.')) data[k] = localStorage.getItem(k)!;
  }
  return { app: 'woodshed', version: 1, exportedAt: new Date().toISOString(), data };
}

/** Writes a backup's entries (overwriting same keys). Returns how many were restored. */
export function restoreBackup(json: unknown): number {
  const b = json as Partial<Backup>;
  if (!b || b.app !== 'woodshed' || typeof b.data !== 'object' || !b.data) throw new Error('Not a Tab Trainer backup file');
  // Validate everything before touching storage, so a bad file can't leave a half-restore.
  const entries = Object.entries(b.data).filter(([k, v]) => k.startsWith('woodshed.') && typeof v === 'string') as [string, string][];
  for (const [, v] of entries) JSON.parse(v); // every stored value is JSON
  if (!entries.length) throw new Error('The backup is empty');
  // Pending debounced saves from this page would overwrite what we restore; stop them.
  clearTimeout(songTimer);
  frozen = true;
  for (const [k, v] of entries) localStorage.setItem(k, v);
  return entries.length;
}

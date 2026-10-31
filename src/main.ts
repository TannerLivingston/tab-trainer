import * as alphaTab from '@coderline/alphatab';
import { installA11y, prefersReducedMotion } from './a11y';
import localSamples from './localSamples';
import { chordDiagram, collectChords, type ChordList } from './chords';
import { Fretboard, type FretNote } from './fretboard';
import { BarNotes } from './notes';
import { Overview, TRACK_COLORS } from './overview';
import { pluck } from './pluck';
import { unpackTitle } from './scoreInfo';
import { isRetabbed, originalTuning, PRESETS, restore as restoreTab, retab } from './retab';
import { attach, captureOriginal, deleteRecording, describeSync, detach, loadRecording, saveRecording, shift, startOnly, syncFromTaps, type Original, type Recording } from './playalong';
import { PitchListener, type PitchReading } from './pitch';
import { PracticeLog } from './practiceLog';
import { addRecent, listRecent, loadMeta, loadPrefs, loadSong, makeBackup, restoreBackup, saveMeta, savePrefs, saveSong, songKey, type PedalAction, type SavedLoop, type SongState } from './storage';
import { toast } from './toast';
import { installToneRouting, setTone, SOUND_BANKS, studioBankAvailable, type Tone } from './tone';
import { noteName, tuningInfo } from './tuning';
import { WaitMode, type WaitStatus } from './waitMode';
import './style.css';

type Track = alphaTab.model.Track;
type Score = alphaTab.model.Score;
type Beat = alphaTab.model.Beat;
type Note = alphaTab.model.Note;
type MasterBar = alphaTab.model.MasterBar;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const viewport = $('viewport');
const prefs = loadPrefs();
const persistPrefs = () => savePrefs(prefs);

// Phones start a little smaller so a whole bar fits across (prefs are per device).
if (window.innerWidth < 700 && prefs.zoom === 100) prefs.zoom = 80;

// Safari's navigator.audioSession is deliberately left on its default ('auto'): setting 'playback'
// (so an iPhone's silent switch doesn't mute playback) and switching to 'play-and-record' for the
// microphone made play/pause noticeably late in Safari on macOS.

// Tone: must be installed before alphaTab creates its AudioContext.
installToneRouting();
const hasStudioBank = await studioBankAvailable();
const activeTone = (): Tone => (prefs.tone === 'studio' && hasStudioBank ? 'studio' : 'basic');
setTone(activeTone());

// ---------------------------------------------------------------------------
// Sheet themes
// ---------------------------------------------------------------------------

const THEMES = {
  paper: { bg: '#fdfcf8', main: '#1b1b1b', secondary: '#1b1b1b66', staff: '#a5a5a5', barSep: '#2a2a2a', barNum: '#c8401a', info: '#1b1b1b' },
  sepia: { bg: '#f4ead5', main: '#33261a', secondary: '#33261a70', staff: '#a08e72', barSep: '#4a3a28', barNum: '#a8461f', info: '#33261a' },
  night: { bg: '#1b1e23', main: '#e4e7eb', secondary: '#e4e7eb70', staff: '#5d6570', barSep: '#8a929c', barNum: '#f2a33a', info: '#e4e7eb' },
} as const;

function applyTheme(settings: alphaTab.Settings, name: keyof typeof THEMES) {
  const t = THEMES[name];
  const r = settings.display.resources;
  const c = (v: string) => alphaTab.model.Color.fromJson(v)!;
  r.mainGlyphColor = c(t.main);
  r.secondaryGlyphColor = c(t.secondary);
  r.staffLineColor = c(t.staff);
  r.barSeparatorColor = c(t.barSep);
  r.barNumberColor = c(t.barNum);
  r.scoreInfoColor = c(t.info);
  document.documentElement.style.setProperty('--paper', t.bg);
  app.dataset.sheet = name;
}

// ---------------------------------------------------------------------------
// alphaTab setup
// ---------------------------------------------------------------------------

const SP = alphaTab.StaveProfile;
const settings = new alphaTab.Settings();
settings.fillFromJson({
  core: { fontDirectory: `${import.meta.env.BASE_URL}font/`, logLevel: 'warning' },
  display: {
    layoutMode: prefs.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page,
    staveProfile: prefs.view === 'tab' ? SP.Tab : prefs.view === 'score' ? SP.Score : SP.Default,
    scale: prefs.zoom / 100,
    padding: [36, 40, 36, 40],
  },
  notation: { rhythmMode: alphaTab.TabRhythmMode.Automatic },
  player: {
    playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
    scrollElement: viewport,
    scrollMode: !prefs.follow
      ? alphaTab.ScrollMode.Off
      : prefs.layout === 'horizontal' && !prefersReducedMotion()
        ? alphaTab.ScrollMode.Smooth
        : alphaTab.ScrollMode.Continuous,
    scrollOffsetY: -60,
    scrollOffsetX: -120,
    enableCursor: true,
    enableAnimatedBeatCursor: !prefersReducedMotion(),
    enableElementHighlighting: true,
    enableUserInteraction: true,
  },
});
applyTheme(settings, prefs.theme);

const api = new alphaTab.AlphaTabApi($('alphaTab'), settings);
const fretboard = new Fretboard($('fretboard'));
fretboard.setOptions({ labels: prefs.fbLabels, lefty: prefs.lefty });
(window as unknown as { api: alphaTab.AlphaTabApi }).api = api;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SectionInfo {
  name: string;
  letter: string;
  startBar: number;
  endBar: number;
  /** Marked by you rather than stored in the file. */
  user?: boolean;
}

const state = {
  fileName: '',
  songKey: '',
  visibleTracks: [] as number[],
  focusTrack: 0,
  fbTrack: 0,
  sections: [] as SectionInfo[],
  loopedSection: -1,
  looping: false,
  loop: null as { start: number; end: number } | null,
  savedLoops: [] as SavedLoop[],
  trainer: false,
  countIn: prefs.countIn,
  metronome: prefs.metronome,
  speed: 100,
  pitch: 0,
  scrubbing: false,
  scrubPct: -1,
  lastTick: 0,
  endTick: 1,
  endTime: 0,
  currentBar: -1,
  useBackingTrack: false,
  trackVolumes: new Map<number, number>(),
  retab: {} as Record<number, number[]>,
  userSections: [] as { bar: number; name: string }[],
  loopPasses: 0,
  recording: null as Recording | null,
  original: null as Original | null,
  /** Saved loop/position waiting for the first render + MIDI of a freshly opened song. */
  pendingRestore: null as Partial<SongState> | null,
  rendered: false,
  midiReady: false,
};

const isPlaying = () => api.playerState === alphaTab.synth.PlayerState.Playing;

// Transport gate. alphaTab starts its audio output asynchronously; a pause or stop that lands
// before the output has really started leaves it broken (and play→pause→play can start two
// outputs). Every play/pause/stop in the app goes through here: after a play, further requests
// wait until playback is actually moving (or a short safety timeout), and the latest request wins.
type TransportAction = 'play' | 'pause' | 'stop';
const transport = { want: null as TransportAction | null, timer: 0, starting: false, startedAt: 0 };
function requestTransport(action: TransportAction) {
  transport.want = action;
  clearTimeout(transport.timer);
  pumpTransport();
}
function pumpTransport() {
  if (transport.starting && performance.now() - transport.startedAt < 900) {
    transport.timer = window.setTimeout(pumpTransport, 40);
    return;
  }
  transport.starting = false;
  const want = transport.want;
  transport.want = null;
  if (!want) return;
  if (want === 'stop') return api.stop();
  if ((want === 'play') === isPlaying()) return;
  if (want === 'play') {
    transport.starting = true;
    transport.startedAt = performance.now();
    api.play();
  } else api.pause();
}
const setPlaying = (play: boolean) => requestTransport(play ? 'play' : 'pause');
const stopPlayback = () => requestTransport('stop');
const togglePlay = () => setPlaying(!(transport.want === 'play' || (transport.want !== 'pause' && isPlaying())));

// Arrangement overview. Created before any alphaTab event subscriptions: alphaTab replays some
// events synchronously on subscribe, and those handlers touch the overview.
const overview = new Overview($('overview'), {
  seekBar: (bar) => seekToBar(bar),
  loopBars: (start, end) => {
    state.loopedSection = -1;
    setLoopBars(start, end);
    setLooping(true, true);
    if (!isPlaying()) seekToBar(start);
  },
  selectTrack: (i, toggle) => selectTrack(i, toggle),
  describeBar: (bar) => {
    const mb = api.score?.masterBars[bar];
    if (!mb) return '';
    const si = sectionAt(bar);
    const tempo = mb.tempoAutomations[0] ? ` · ♩${Math.round(mb.tempoAutomations[0].value)}` : '';
    return `Bar ${bar + 1} · ${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}${tempo}${si >= 0 ? ` · ${state.sections[si].name}` : ''}`;
  },
});

// Practice notes pinned to bars (also referenced by render handlers below).
const barNotes = new BarNotes(api, $('pinLayer'), $('barNotes'), {
  changed: (notes) => {
    overview.setNotes(notes.map((n) => n.bar));
    persistSong();
  },
  seekBar: (bar) => seekToBar(bar),
  deleted: (note, restore) => toast(`Deleted note on bar ${note.bar + 1}`, { ms: 6000, action: { label: 'Undo', run: restore } }),
});

// Microphone: one listener feeds both the tuner and wait mode.
const waitMode = new WaitMode(api, {
  track: () => state.fbTrack,
  pitchShift: () => state.pitch,
  onStatus: (s) => renderWaitStatus(s),
  setPlaying: (p) => setPlaying(p),
});
const listener = new PitchListener((r) => {
  waitMode.onPitch(r);
  if (waitMode.active) renderWaitHearing(r);
  if (!$('tunerModal').hidden) renderTuner(r);
});

const practiceLog = new PracticeLog();
setInterval(() => isPlaying() && practiceLog.flush(), 30000);
// Declared early: the player can report its state and position during start-up (alphaTab replays
// them to new listeners), and those handlers refresh the goal ring, scrubber and seek tracking.
let goalCelebrated = false;
const scrub = $('scrub');
let userSeekAt = 0;
const markUserSeek = () => (userSeekAt = performance.now());

// Screen wake lock while playing (declared early: player events can fire during start-up).
type WakeLock = { release(): Promise<void> };
let wakeLock: WakeLock | null = null;

/** Pending timers for the on-screen count-in numbers. */
let countInTimers: number[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtSemis = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const trackColor = (i: number) => TRACK_COLORS[i % TRACK_COLORS.length];

function setLoading(text: string | null) {
  $('loading').classList.toggle('show', text !== null);
  if (text) $('loadingText').textContent = text;
}

const ICONS = {
  guitar:
    '<svg viewBox="0 0 24 24"><path d="M15.42 8.57C14.72 9.09 12.01 6.99 9.88 9.12C8.85 10.15 8.91 11.07 8.3 11.67C7.69 12.28 5.57 11.13 4.11 12.59C2.34 14.35 3.07 17.51 4.78 19.21C6.48 20.92 9.64 21.65 11.4 19.88C12.86 18.42 11.71 16.3 12.32 15.69A2.84 2.84 0 0 0 13.1 13.19" /><path d="M14.14 9.85L18.7 5.29" /><path d="M18.34 4.92L20.04 3.22L20.77 3.95L19.07 5.65Z" /></svg>',
  bass: '<svg viewBox="0 0 24 24"><path d="M20 2l2 2-7 7M14 10a3 3 0 0 0-4 0l-.5.5a2 2 0 0 1-1.6.6 4 4 0 0 0-3.4 6.4 4 4 0 0 0 6.4-3.4 2 2 0 0 1 .6-1.6L12 12" /><path d="M7 15l2 2" /></svg>',
  drums:
    '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9" rx="8" ry="3" /><path d="M4 9v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9M15 3l-3 6M9 3l3 6" /></svg>',
  keys: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v8M12 5v8M16 5v8M8 13v6M12 13v6M16 13v6" /></svg>',
  strings:
    '<svg viewBox="0 0 24 24"><path d="M12 3c3 0 4 3 4 6s-2 4-2 6 3 2 3 4-2 2-5 2-5-1-5-2 3-2 3-4-2-3-2-6 1-6 4-6zM12 6v13" /></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M4 14l12-8 4 4-8 12zM7 12l5 5M14 5l5 5" /></svg>',
  voice:
    '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>',
  synth: '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-6 4 12 3-9 2 3h6" /></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>',
  loop: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4" /></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>',
};

function iconFor(track: Track): string {
  const staff = track.staves[0];
  if (staff?.isPercussion) return ICONS.drums;
  const p = track.playbackInfo.program;
  if (p >= 32 && p <= 39) return ICONS.bass;
  if (p >= 24 && p <= 31) return ICONS.guitar;
  if (p <= 23) return ICONS.keys;
  if (p >= 40 && p <= 51) return ICONS.strings;
  if (p >= 52 && p <= 54) return ICONS.voice;
  if (p >= 56 && p <= 79) return ICONS.wind;
  if (staff?.isStringed && staff.tuning.length >= 4) return staff.tuning.length <= 5 ? ICONS.bass : ICONS.guitar;
  return ICONS.synth;
}

// ---------------------------------------------------------------------------
// Menus & popovers: one open at a time, closed by any outside click
// ---------------------------------------------------------------------------

const POPUPS: [string, string][] = [
  ['libraryBtn', 'libraryMenu'],
  ['displayBtn', 'displayMenu'],
  ['moreBtn', 'moreMenu'],
  ['speedPresetsBtn', 'speedPresets'],
];
function closePopups(except?: string) {
  for (const [, menu] of [...POPUPS, ['trainerBtn', 'trainerPop']]) if (menu !== except) $(menu).classList.remove('open');
}
for (const [btn, menu] of POPUPS) {
  $(btn).addEventListener('click', (e) => {
    e.stopPropagation();
    closePopups(menu);
    $(menu).classList.toggle('open');
    if (menu === 'libraryMenu') renderLibrary();
  });
  $(menu).addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('click', () => closePopups());

// ---------------------------------------------------------------------------
// Library: recent files, the bundled demo songs, and your own /samples folder
// ---------------------------------------------------------------------------

type LibraryEntry = { name: string; url: string };
const entries = (files: Record<string, string>): LibraryEntry[] =>
  Object.entries(files)
    .map(([path, url]) => ({ name: decodeURIComponent(path.split('/').pop()!), url }))
    .sort((a, b) => a.name.localeCompare(b.name));
// Demos are public-domain melodies and original exercises (see demos/src), so they ship.
const demos = entries(
  import.meta.glob('/demos/*.gp', { query: '?url', import: 'default', eager: true }) as Record<string, string>,
);
// Your own files in /samples may be copyrighted: listed in local development only (empty in a build).
const samples = entries(localSamples);
const library = [...demos, ...samples];
const sampleLabel = 'Your samples folder';

function libraryItem(name: string, onOpen: () => void, when = '') {
  const b = document.createElement('button');
  b.className = 'menu-item lib-item';
  const ext = name.split('.').pop()!;
  // Once a song has been opened we know its real title, artist and size.
  const meta = loadMeta()[name];
  const title = meta?.title || name.replace(/\.[^.]+$/, '');
  const practised = meta ? Math.round(PracticeLog.totalFor(meta.key) / 60000) : 0;
  const details = [meta?.artist, meta ? `${meta.tracks} track${meta.tracks === 1 ? '' : 's'} · ${meta.bars} bars` : '', practised ? `${practised} min practised` : '']
    .filter(Boolean)
    .join(' · ');
  b.innerHTML = `<span class="ext">${escapeHtml(ext)}</span><span class="mi-text"><span class="mi-name"></span>${details ? `<span class="mi-sub"></span>` : ''}</span>${when ? `<span class="mi-meta">${when}</span>` : ''}`;
  b.querySelector('.mi-name')!.textContent = title;
  if (details) b.querySelector('.mi-sub')!.textContent = details;
  b.title = name;
  b.dataset.search = `${name} ${title} ${meta?.artist ?? ''}`.toLowerCase();
  b.onclick = () => {
    closePopups();
    onOpen();
  };
  return b;
}

function addSearch(host: HTMLElement) {
  const box = document.createElement('input');
  box.type = 'search';
  box.className = 'lib-search';
  box.placeholder = 'Search songs…';
  box.setAttribute('aria-label', 'Search songs');
  box.oninput = () => {
    const q = box.value.trim().toLowerCase();
    for (const item of host.querySelectorAll<HTMLElement>('.lib-item')) item.hidden = !!q && !item.dataset.search!.includes(q);
  };
  box.onkeydown = (e) => {
    if (e.key === 'Enter') host.querySelector<HTMLElement>('.lib-item:not([hidden])')?.click();
  };
  host.prepend(box);
  requestAnimationFrame(() => box.focus());
}

async function renderLibrary() {
  const host = $('libraryMenu');
  const recent = await listRecent();
  host.replaceChildren();
  if (recent.length) {
    host.insertAdjacentHTML('beforeend', '<div class="menu-label">Recent</div>');
    for (const r of recent) host.append(libraryItem(r.name, () => loadBytes(r.bytes, r.name), relTime(r.openedAt)));
  }
  host.insertAdjacentHTML('beforeend', '<div class="menu-label">Demo songs</div>');
  for (const e of demos) host.append(libraryItem(e.name, () => loadUrl(e.url, e.name)));
  if (import.meta.env.DEV) {
    host.insertAdjacentHTML('beforeend', `<div class="menu-label">${sampleLabel}</div>`);
    if (!samples.length) host.insertAdjacentHTML('beforeend', '<div class="menu-empty">No files in /samples yet.</div>');
    for (const e of samples) host.append(libraryItem(e.name, () => loadUrl(e.url, e.name)));
  }
  if (recent.length + library.length > 6) addSearch(host);
}
function relTime(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
async function renderEmptyList() {
  const host = $('emptySamples');
  const recent = await listRecent();
  host.replaceChildren();
  if (recent.length) {
    host.insertAdjacentHTML('beforeend', '<div class="menu-label">Pick up where you left off</div>');
    for (const r of recent.slice(0, 4)) host.append(libraryItem(r.name, () => loadBytes(r.bytes, r.name), relTime(r.openedAt)));
  }
  for (const [label, list] of [['Demo songs', demos], [sampleLabel, samples]] as const) {
    if (!list.length) continue;
    host.insertAdjacentHTML('beforeend', `<div class="menu-label">${label}</div>`);
    for (const e of list) host.append(libraryItem(e.name, () => loadUrl(e.url, e.name)));
  }
}
renderEmptyList();

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadUrl(url: string, name: string) {
  setLoading(`Loading ${name}…`);
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  loadBytes(new Uint8Array(buf), name);
}

// alphaTab engraves in a worker; if a new song is loaded mid-engraving, the old render's results
// arrive afterwards and reference beats that no longer exist (it throws). So a load waits until
// the current engraving has finished (or a safety timeout), and only the latest request runs.
const engraving = { busy: false, since: 0, queued: null as (() => void) | null, timer: 0 };
function whenEngravingIdle(run: () => void) {
  clearTimeout(engraving.timer);
  if (!engraving.busy || performance.now() - engraving.since > 6000) {
    engraving.queued = null;
    run();
    return;
  }
  engraving.queued = run;
  engraving.timer = window.setTimeout(() => whenEngravingIdle(run), 250);
}

function loadBytes(bytes: Uint8Array, name: string, remember = false) {
  setLoading(`Reading ${name}…`);
  whenEngravingIdle(() => openBytes(bytes, name, remember));
}
function openBytes(bytes: Uint8Array, name: string, remember: boolean) {
  state.fileName = name;
  setLoading(`Reading ${name}…`);
  api.stop();
  api.settings.notation.elements.set(alphaTab.NotationElement.GuitarTuning, true);
  api.updateSettings();
  try {
    if (!api.load(bytes)) throw new Error('Unsupported file');
    if (remember) addRecent(name, bytes);
  } catch (err) {
    setLoading(null);
    toast(`Could not open ${name}: ${(err as Error).message}`, { ms: 4000 });
  }
}

const openPicker = () => $<HTMLInputElement>('fileInput').click();
$('openBtn').onclick = openPicker;
$('emptyOpen').onclick = openPicker;
$<HTMLInputElement>('fileInput').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadBytes(new Uint8Array(await file.arrayBuffer()), file.name, true);
  (e.target as HTMLInputElement).value = '';
};

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  app.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) app.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadBytes(new Uint8Array(await file.arrayBuffer()), file.name, true);
});

// ---------------------------------------------------------------------------
// Score loaded → populate UI, restore this song's practice state
// ---------------------------------------------------------------------------

api.scoreLoaded.on((score) => {
  unpackTitle(score);
  app.classList.remove('no-score');
  $('songTitle').textContent = score.title || state.fileName.replace(/\.[^.]+$/, '');
  $('songArtist').textContent = [score.artist, score.album].filter(Boolean).join(' — ') || ' ';
  document.title = `${score.title || state.fileName} · Tab Trainer`;

  freshScore = true;
  state.rendered = false;
  state.midiReady = false;
  state.loopedSection = -1;
  state.currentBar = -1;
  state.lastTick = 0;
  state.endTime = 0;
  state.endTick = 1;
  currentOriginalTempo = 0;
  state.trackVolumes.clear();
  state.visibleTracks = api.tracks.map((t) => t.index);
  state.focusTrack = state.visibleTracks[0] ?? 0;

  state.songKey = songKey([score.title, score.artist, score.masterBars.length, score.tracks.length]);
  const saved = loadSong(state.songKey) ?? {};
  state.savedLoops = saved.loops ?? [];
  state.userSections = saved.sections ?? [];
  barNotes.set(saved.notes ?? []);
  practiceLog.setSong(state.songKey, score.title || state.fileName);
  saveMeta(state.fileName, { title: score.title, artist: score.artist, tracks: score.tracks.length, bars: score.masterBars.length, key: state.songKey });
  state.pitch = saved.pitch ?? 0;
  for (const [i, m] of Object.entries(saved.mixer ?? {})) {
    const t = score.tracks[Number(i)];
    if (!t) continue;
    t.playbackInfo.isMute = m.mute;
    t.playbackInfo.isSolo = m.solo;
    if (m.vol !== 1) state.trackVolumes.set(t.index, m.vol);
  }
  setSpeed(saved.speed ?? 100, true);
  state.pendingRestore = saved;
  state.retab = saved.retab ?? {};
  for (const [i, tuning] of Object.entries(state.retab)) {
    const t = score.tracks[Number(i)];
    if (t && t.staves[0].tuning.length === tuning.length) retab(t, tuning);
  }

  if (waitMode.active) setWait(false);
  if (!$('syncModal').hidden) closeSync();
  if (!$('progressModal').hidden) setProgress(false);
  state.original = captureOriginal(score);
  state.recording = null;
  if (state.useBackingTrack) setSource(false, true);
  updateSourceButton();
  renderRecording();
  const key = state.songKey;
  loadRecording(key).then((rec) => {
    if (!rec || state.songKey !== key || !api.score) return;
    state.recording = rec;
    attach(api.score, rec);
    api.updateSyncPoints();
    updateSourceButton();
    renderRecording();
  });

  buildSongInfo(score);
  buildSections(score);
  overview.setScore(score);
  overview.setSections(state.sections);
  overview.setNotes(barNotes.notes.map((n) => n.bar));
  overview.setTempoChanges(tempoChanges(score));
  buildTrackList();
  clearLoop(true);
  renderSavedLoops();
  updatePitchUi();

  if (!prefs.seenTips) $('tips').hidden = false;
  const visible = (saved.visible ?? []).filter((i) => i < score.tracks.length);
  if (visible.length && visible.join() !== state.visibleTracks.join()) {
    // Defer so alphaTab finishes its own first render request before we replace it.
    setTimeout(() => setVisibleTracks(visible, visible[0]));
  } else {
    setupFretboard();
  }
});

let freshScore = false;
api.renderStarted.on(() => {
  engraving.busy = true;
  engraving.since = performance.now();
  setLoading('Engraving…');
});
api.renderFinished.on(() => setLoading(null));
api.postRenderFinished.on(() => {
  engraving.busy = false;
  const next = engraving.queued;
  if (next) {
    engraving.queued = null;
    clearTimeout(engraving.timer);
    setTimeout(next);
  }
  // Start a newly opened song at the top of the sheet (title visible) rather than at the cursor.
  if (freshScore) {
    freshScore = false;
    requestAnimationFrame(() => viewport.scrollTo({ top: 0, left: 0 }));
  }
  state.rendered = true;
  barNotes.render();
  tryRestore();
});
api.error.on((e) => {
  setLoading(null);
  console.error(e);
  // Parse failures arrive here rather than as an exception from api.load().
  toast(`Couldn't read ${state.fileName || 'this file'}. It may be damaged or from an unsupported Guitar Pro version.`, { ms: 5000 });
});
// The sound bank streams in alongside the first song; its progress shares the loading pill, so it
// must also clear the pill itself (it can finish after the score has already rendered).
const SOUNDS = 'Loading sounds';
const clearSoundsPill = () => $('loadingText').textContent?.startsWith(SOUNDS) && setLoading(null);
api.soundFontLoad.on((e) => {
  if (e.total > 0 && e.loaded < e.total) setLoading(`${SOUNDS} ${Math.round((e.loaded / e.total) * 100)}%`);
  else clearSoundsPill();
});
api.soundFontLoaded.on(clearSoundsPill);
api.playerReady.on(() => {
  $<HTMLButtonElement>('playBtn').disabled = false;
  clearSoundsPill();
});
api.midiLoad.on(() => {
  // Mute/solo/volume/pitch survive a MIDI regeneration (e.g. after switching audio source).
  applyMixer();
  state.midiReady = true;
  setTimeout(tryRestore);
});
/**
 * Download a sound bank ourselves (with progress) and hand the bytes to alphaTab. alphaTab's own
 * URL loading just stalls on a network failure; this way a failed Studio bank falls back to Basic.
 */
let bankRequest = 0;
async function loadSoundBank(t: Tone): Promise<boolean> {
  const req = ++bankRequest;
  setTone(t);
  setLoading('Loading sounds…');
  try {
    const res = await fetch(SOUND_BANKS[t]);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total && req === bankRequest) setLoading(`Loading sounds ${Math.round((got / total) * 100)}%`);
    }
    if (req !== bankRequest) return false; // superseded by a newer switch
    const bytes = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    api.resetSoundFonts();
    api.loadSoundFont(bytes);
    return true;
  } catch {
    if (req !== bankRequest) return false;
    setLoading(null);
    if (t === 'studio') {
      prefs.tone = 'basic';
      segmentedMark('toneMode', 'basic');
      toast("Couldn't load the Studio sounds, so playing with Basic MIDI instead.", { ms: 5000 });
      return loadSoundBank('basic');
    }
    toast("Couldn't load the sound bank. Check your connection and reload.", { ms: 6000 });
    return false;
  }
}
loadSoundBank(activeTone());

// Note: api.midiLoaded is deliberately not subscribed: in alphaTab 1.8.4 the worker synth's
// `loadedMidiInfo` getter recurses forever when a late subscriber replays it.
// playerPositionChanged fires right after MIDI load and carries the same end tick/time.

function tryRestore() {
  const r = state.pendingRestore;
  if (!r || !state.rendered || !state.midiReady || !api.tickCache) return;
  state.pendingRestore = null;
  if (r.loop) {
    setLoopBars(r.loop.start, r.loop.end);
    setLooping(true, true);
  }
  if (r.bar && r.bar > 0) {
    seekToBar(r.bar);
    toast(`Picked up where you left off: bar ${r.bar + 1}`, { action: { label: 'Start over', run: () => stopPlayback() }, ms: 4000 });
  }
}

function persistSong() {
  const score = api.score;
  if (!score || !state.songKey) return;
  const mixer: SongState['mixer'] = {};
  for (const t of score.tracks) {
    const vol = state.trackVolumes.get(t.index) ?? 1;
    if (t.playbackInfo.isMute || t.playbackInfo.isSolo || vol !== 1) mixer[t.index] = { mute: t.playbackInfo.isMute, solo: t.playbackInfo.isSolo, vol };
  }
  saveSong(state.songKey, {
    speed: state.speed,
    pitch: state.pitch,
    visible: state.visibleTracks,
    mixer,
    loop: state.loop,
    bar: Math.max(0, state.currentBar),
    loops: state.savedLoops,
    notes: barNotes.notes,
    retab: state.retab,
    sections: state.userSections,
  });
}

/** Bars where the tempo changes (after the first), for the overview. */
function tempoChanges(score: Score) {
  const out: { bar: number; bpm: number }[] = [];
  let last = score.masterBars[0]?.tempoAutomations[0]?.value ?? 0;
  for (const mb of score.masterBars) {
    for (const a of mb.tempoAutomations) {
      if (Math.round(a.value) !== Math.round(last)) out.push({ bar: mb.index, bpm: Math.round(a.value) });
      last = a.value;
    }
  }
  return out;
}

function buildSongInfo(score: Score) {
  const firstBar = score.masterBars[0];
  const tempo = firstBar?.tempoAutomations[0]?.value ?? (score as unknown as { tempo: number }).tempo ?? 120;
  const guitar = score.tracks.find((t) => tuningInfo(t));
  const tun = guitar ? tuningInfo(guitar) : null;
  const key = score.tracks[0]?.staves[0]?.bars[0];
  const keyText = key ? keySignatureText(key.keySignature as number, key.keySignatureType as number) : '';
  const rows: [string, string][] = [
    ['Artist', score.artist],
    ['Album', score.album],
    ['Music', score.music],
    ['Tab by', score.tab],
    ['Tempo', `♩ = ${Math.round(tempo)}`],
    ['Time', firstBar ? `${firstBar.timeSignatureNumerator}/${firstBar.timeSignatureDenominator}` : ''],
    ['Key', keyText],
    ['Bars', String(score.masterBars.length)],
    ['Length', ''],
    ['Tuning', tun ? (tun.isStandard ? tun.name : `${tun.name} (${tun.notes})`) : ''],
    ['Capo', tun && tun.capo ? `Fret ${tun.capo}` : ''],
    ['Audio', score.backingTrack ? 'Embedded recording' : ''],
  ];
  $('songInfo').innerHTML = rows
    .filter(([k, v]) => v || k === 'Length')
    .map(([k, v]) => {
      if (k === 'Length' && state.endTime > 0) v = fmtTime(state.endTime * api.playbackSpeed);
      return `<dt>${k}</dt><dd${k === 'Length' ? ' id="songLength"' : ''} title="${escapeHtml(v)}">${escapeHtml(v || '–')}</dd>`;
    })
    .join('');
}

function keySignatureText(ks: number, type: number) {
  const major = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const minor = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
  const i = ks + 7;
  if (i < 0 || i >= major.length) return '';
  return type === 1 ? `${minor[i]} minor` : `${major[i]} major`;
}

// ---------------------------------------------------------------------------
// Tracks: visibility, mute/solo, volume, activity
// ---------------------------------------------------------------------------

function buildTrackList() {
  const list = $('trackList');
  list.replaceChildren();
  const score = api.score!;
  for (const track of score.tracks) {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = String(track.index);
    li.style.setProperty('--track-color', trackColor(track.index));
    const tun = tuningInfo(track);
    const staff = track.staves[0];
    let sub = '';
    if (tun) {
      sub = `<span class="tuning">${tun.notes}</span>`;
      const tags = [tun.isStandard ? '' : tun.name, tun.capo ? `Capo ${tun.capo}` : ''].filter(Boolean);
      if (tags.length) sub = `<span class="tag">${escapeHtml(tags.join(' · '))}</span><br>${sub}`;
    } else if (staff?.isPercussion) {
      sub = 'Drum kit';
    } else {
      sub = 'Notation';
    }
    const vol = Math.round((state.trackVolumes.get(track.index) ?? 1) * 100);
    li.innerHTML = `
      <div class="track-row">
        <div class="track-icon">${iconFor(track)}<b class="led"></b></div>
        <div class="track-main">
          <div class="track-name">${escapeHtml(track.name || `Track ${track.index + 1}`)}</div>
          <div class="track-sub">${sub}</div>
        </div>
        <button class="icon-btn track-eye" title="Show / hide in score" aria-label="Show ${escapeHtml(track.name)} in score">${ICONS.eye}</button>
      </div>
      <div class="track-mix">
        <button class="ms mute" title="Mute" aria-label="Mute ${escapeHtml(track.name)}">M</button>
        <button class="ms solo" title="Solo" aria-label="Solo ${escapeHtml(track.name)}">S</button>
        <input type="range" min="0" max="150" value="${vol}" title="Volume" aria-label="${escapeHtml(track.name)} volume" />
      </div>`;
    li.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.track-mix')) return;
      const toggleOnly = e.metaKey || e.ctrlKey || !!(e.target as HTMLElement).closest('.track-eye');
      selectTrack(track.index, toggleOnly);
    };
    li.querySelector<HTMLButtonElement>('.mute')!.onclick = () => {
      track.playbackInfo.isMute = !track.playbackInfo.isMute;
      api.changeTrackMute([track], track.playbackInfo.isMute);
      refreshTrackList();
      persistSong();
    };
    li.querySelector<HTMLButtonElement>('.solo')!.onclick = () => {
      track.playbackInfo.isSolo = !track.playbackInfo.isSolo;
      api.changeTrackSolo([track], track.playbackInfo.isSolo);
      refreshTrackList();
      persistSong();
    };
    const volInput = li.querySelector<HTMLInputElement>('input')!;
    volInput.oninput = () => {
      state.trackVolumes.set(track.index, Number(volInput.value) / 100);
      api.changeTrackVolume([track], Number(volInput.value) / 100);
      persistSong();
    };
    list.append(li);
  }
  refreshTrackList();
}

function refreshTrackList() {
  const score = api.score;
  if (!score) return;
  for (const li of $('trackList').querySelectorAll<HTMLLIElement>('.track')) {
    const t = score.tracks[Number(li.dataset.index)];
    li.classList.toggle('visible', state.visibleTracks.includes(t.index));
    li.classList.toggle('muted', t.playbackInfo.isMute);
    li.querySelector('.mute')!.classList.toggle('on', t.playbackInfo.isMute);
    li.querySelector('.solo')!.classList.toggle('on', t.playbackInfo.isSolo);
  }
  const anySolo = score.tracks.some((t) => t.playbackInfo.isSolo);
  const silent = score.tracks.filter((t) => t.playbackInfo.isMute || (anySolo && !t.playbackInfo.isSolo)).map((t) => t.index);
  overview.setTrackState(state.visibleTracks, silent);
}

function applyMixer() {
  const score = api.score;
  if (!score) return;
  for (const t of score.tracks) {
    if (t.playbackInfo.isMute) api.changeTrackMute([t], true);
    if (t.playbackInfo.isSolo) api.changeTrackSolo([t], true);
    const v = state.trackVolumes.get(t.index);
    if (v !== undefined) api.changeTrackVolume([t], v);
  }
  api.changeTrackTranspositionPitch(score.tracks, state.pitch);
}

function selectTrack(index: number, toggle: boolean) {
  let next: number[];
  if (toggle) {
    next = state.visibleTracks.includes(index) ? state.visibleTracks.filter((i) => i !== index) : [...state.visibleTracks, index];
    if (!next.length) return;
    next.sort((a, b) => a - b);
  } else {
    next = [index];
  }
  const focus = !toggle || !next.includes(state.focusTrack) ? (next.includes(index) ? index : next[0]) : state.focusTrack;
  setVisibleTracks(next, focus);
  persistSong();
}

function setVisibleTracks(next: number[], focus: number) {
  const score = api.score!;
  state.visibleTracks = next;
  state.focusTrack = focus;
  // Stacked staves each print their tuning header and alphaTab overlaps them; when every visible
  // track is in standard tuning that header adds nothing (the sidebar shows tunings anyway).
  const allStandard = next.every((i) => tuningInfo(score.tracks[i])?.isStandard ?? true);
  api.settings.notation.elements.set(alphaTab.NotationElement.GuitarTuning, !(next.length > 1 && allStandard));
  api.updateSettings();
  api.renderTracks(next.map((i) => score.tracks[i]));
  refreshTrackList();
  setupFretboard();
  updatePitchUi();
}

let lastActive = '';
api.activeBeatsChanged.on((e) => {
  const active = new Set<number>();
  for (const b of e.activeBeats) if (!b.isRest && b.notes.length) active.add(b.voice.bar.staff.track.index);
  const key = [...active].join();
  if (key !== lastActive) {
    lastActive = key;
    for (const li of $('trackList').querySelectorAll<HTMLElement>('.track')) li.classList.toggle('active', active.has(Number(li.dataset.index)));
    overview.setActivity(active);
  }
  if (app.classList.contains('show-fretboard')) showFretboardBeats(e.activeBeats);
  if (chordList && app.classList.contains('show-chords')) {
    for (const b of e.activeBeats) {
      const key = chordList.beatKeys.get(b);
      if (key) markChord(key);
    }
  }
});

// ---------------------------------------------------------------------------
// Sections (rehearsal markers)
// ---------------------------------------------------------------------------

function buildSections(score: Score) {
  const bars = score.masterBars;
  const list: SectionInfo[] = [];
  bars.forEach((mb, i) => {
    if (!mb.section) return;
    list.push({ name: mb.section.text || mb.section.marker || `Section ${list.length + 1}`, letter: mb.section.marker, startBar: i, endBar: bars.length - 1 });
  });
  // Your own section marks (X), merged in bar order; a mark on the same bar as the file's wins.
  for (const u of state.userSections) {
    const at = list.findIndex((x) => x.startBar === u.bar);
    const entry = { name: u.name, letter: '', startBar: u.bar, endBar: bars.length - 1, user: true };
    if (at >= 0) list[at] = entry;
    else list.push(entry);
  }
  list.sort((a, b) => a.startBar - b.startBar);
  for (let i = 0; i < list.length - 1; i++) list[i].endBar = list[i + 1].startBar - 1;
  state.sections = list;
  app.classList.toggle('has-sections', list.length > 0);
  const host = $('sections');
  host.replaceChildren();
  list.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = `section-chip${s.user ? ' user' : ''}`;
    b.title = `Bars ${s.startBar + 1}–${s.endBar + 1}. Click to jump; with Loop on, loops this section.${s.user ? ' Right-click to rename or remove.' : ''}`;
    b.innerHTML = `${s.letter && s.letter !== s.name ? `<b>${escapeHtml(s.letter)}</b>` : ''}${escapeHtml(s.name)}`;
    b.onclick = () => onSectionClick(i);
    if (s.user)
      b.oncontextmenu = (e) => {
        e.preventDefault();
        editSection(s.startBar);
      };
    host.append(b);
  });
  const add = document.createElement('button');
  add.className = 'section-chip add';
  add.textContent = '+ Section';
  add.title = 'Mark a section starting at the current bar (X)';
  add.onclick = () => editSection(Math.max(0, state.currentBar));
  host.append(add);
  overview.setSections(list);
  refreshSectionChips();
}

/** Inline editor for naming (or removing) your own section mark at `bar`. */
function editSection(bar: number) {
  const score = api.score;
  if (!score) return;
  const existing = state.userSections.find((u) => u.bar === bar);
  const pop = $('sectionPop');
  const input = pop.querySelector('input')!;
  pop.querySelector('.sp-title')!.textContent = `${existing ? 'Section' : 'New section'} at bar ${bar + 1}`;
  input.value = existing?.name ?? suggestSectionName(bar);
  pop.querySelector<HTMLElement>('.sp-remove')!.hidden = !existing;
  pop.hidden = false;
  input.focus();
  input.select();
  const close = () => (pop.hidden = true);
  const save = () => {
    const name = input.value.trim();
    state.userSections = state.userSections.filter((u) => u.bar !== bar);
    if (name) state.userSections.push({ bar, name });
    close();
    buildSections(score);
    persistSong();
    if (name) toast(`Section "${name}" from bar ${bar + 1}`);
  };
  pop.querySelector<HTMLElement>('.sp-save')!.onclick = save;
  pop.querySelector<HTMLElement>('.sp-remove')!.onclick = () => {
    input.value = '';
    save();
  };
  pop.querySelector<HTMLElement>('.sp-cancel')!.onclick = close;
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') close();
  };
}
function suggestSectionName(bar = state.currentBar) {
  const names = [...(bar <= 0 ? ['Intro'] : []), 'Verse', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge', 'Solo', 'Verse 3', 'Chorus 3', 'Outro'];
  const used = new Set(state.sections.map((x) => x.name));
  return names.find((n) => !used.has(n)) ?? `Section ${state.sections.length + 1}`;
}

function onSectionClick(i: number) {
  const s = state.sections[i];
  if (state.looping) {
    if (state.loopedSection === i) {
      clearLoop();
    } else {
      state.loopedSection = i;
      setLoopBars(s.startBar, s.endBar);
    }
    refreshSectionChips();
  }
  seekToBar(s.startBar);
}

function refreshSectionChips() {
  const chips = $('sections').children;
  const cur = sectionAt(state.currentBar);
  for (let i = 0; i < chips.length; i++) {
    chips[i].classList.toggle('looped', i === state.loopedSection);
    chips[i].classList.toggle('current', i === cur);
  }
}

function sectionAt(bar: number) {
  let idx = -1;
  state.sections.forEach((s, i) => {
    if (bar >= s.startBar) idx = i;
  });
  return idx;
}

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

function barBeats(barIndex: number): { first: Beat; last: Beat } | null {
  const score = api.score;
  if (!score) return null;
  const track = score.tracks[state.visibleTracks[0] ?? 0];
  const bar = track.staves[0].bars[barIndex];
  const voice = bar?.voices[0];
  if (!voice || !voice.beats.length) return null;
  return { first: voice.beats[0], last: voice.beats[voice.beats.length - 1] };
}

function setLoopBars(start: number, end: number) {
  const a = barBeats(start);
  const b = barBeats(end);
  if (!a || !b) return;
  api.highlightPlaybackRange(a.first, b.last);
  api.applyPlaybackRangeFromHighlight();
}

function clearLoop(quiet = false) {
  const had = !!api.playbackRange;
  state.loopedSection = -1;
  api.clearPlaybackRangeHighlight();
  api.playbackRange = null;
  refreshSectionChips();
  updateLoopUi();
  if (had && !quiet) toast('Loop cleared', { key: 'loop' });
}

function rangeBars(): { start: number; end: number } | null {
  const range = api.playbackRange;
  if (!range) return null;
  const a = masterBarAtTick(range.startTick);
  const b = masterBarAtTick(Math.max(range.startTick, range.endTick - 1));
  if (!a || !b) return null;
  return { start: a.masterBar.index, end: b.masterBar.index };
}

api.playbackRangeChanged.on(() => {
  if (!api.playbackRange) {
    // A plain click on the sheet clears the range; forget any section loop with it.
    if (state.loopedSection !== -1) {
      state.loopedSection = -1;
      refreshSectionChips();
    }
  } else if (state.loopedSection === -1) {
    // Hand-made selection on the sheet: turn looping on, like a guitarist would expect.
    setLooping(true, true);
  }
  updateLoopUi();
  const bars = state.loop;
  if (bars && api.playbackRange) toast(`Loop: bars ${bars.start + 1}–${bars.end + 1}`, { key: 'loop' });
  persistSong();
});

/** Pass counter on the Loop button, for "five clean passes" practice. */
function renderLoopPasses() {
  const btn = $('loopBtn');
  let badge = btn.querySelector<HTMLElement>('.badge');
  if (!state.loopPasses) return badge?.remove();
  if (!badge) btn.append((badge = Object.assign(document.createElement('b'), { className: 'badge' })));
  badge.textContent = `×${state.loopPasses}`;
  btn.setAttribute('aria-label', `Loop, ${state.loopPasses} pass${state.loopPasses === 1 ? '' : 'es'} completed`);
}

function updateLoopUi() {
  const before = state.loop ? `${state.loop.start}-${state.loop.end}` : '';
  state.loop = rangeBars();
  if ((state.loop ? `${state.loop.start}-${state.loop.end}` : '') !== before) {
    state.loopPasses = 0;
    renderLoopPasses();
  }
  updateScrubRange();
  overview.setLoop(state.loop);
  $<HTMLButtonElement>('saveLoopBtn').disabled = !state.loop;
}

// Quick loops for chunk-by-chunk practice.
const lastBar = () => (api.score?.masterBars.length ?? 1) - 1;
function loopRange(start: number, end: number) {
  start = Math.max(0, Math.min(start, lastBar()));
  end = Math.max(start, Math.min(end, lastBar()));
  state.loopedSection = -1;
  setLoopBars(start, end);
  setLooping(true, true);
  seekToBar(start);
}
function loopBarsFromHere(n: number) {
  if (!api.score) return;
  const start = Math.max(0, state.currentBar);
  const l = state.loop;
  if (l && l.start === start && l.end === Math.min(start + n - 1, lastBar())) return clearLoop();
  loopRange(start, start + n - 1);
}
function resizeLoop(delta: number) {
  const l = state.loop;
  if (!l) return loopBarsFromHere(1);
  loopRange(l.start, Math.max(l.start, l.end + delta));
}
function moveLoop(dir: number) {
  const l = state.loop;
  if (!l) return loopBarsFromHere(4);
  const len = l.end - l.start + 1;
  const start = Math.max(0, Math.min(l.start + dir * len, lastBar() - len + 1));
  loopRange(start, start + len - 1);
}

function setLooping(on: boolean, quiet = false) {
  if (state.looping === on) return;
  state.looping = on;
  api.isLooping = on;
  $('loopBtn').classList.toggle('on', on);
  if (!on && state.loopedSection !== -1) clearLoop(true);
  if (!quiet) toast(on ? 'Loop on' : 'Loop off', { key: 'loop' });
}
$('loopBtn').onclick = () => setLooping(!state.looping);

// Saved loops ("practice markers") per song.
function renderSavedLoops() {
  const host = $('savedLoops');
  host.replaceChildren();
  if (!state.savedLoops.length) {
    host.innerHTML = '<li class="empty-note">Drag across bars (or press 1, 2, 4 or 8) to loop them, then save the loop here.</li>';
    return;
  }
  state.savedLoops.forEach((l, i) => {
    const li = document.createElement('li');
    li.className = 'saved-loop';
    li.innerHTML = `${ICONS.loop}<span class="sl-name"></span><span class="sl-bars">${l.start + 1}–${l.end + 1}</span><button class="icon-btn sl-del" title="Delete">${ICONS.close}</button>`;
    li.querySelector('.sl-name')!.textContent = l.name;
    li.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.sl-del')) {
        const [gone] = state.savedLoops.splice(i, 1);
        renderSavedLoops();
        persistSong();
        toast(`Deleted "${gone.name}"`, {
          ms: 6000,
          action: {
            label: 'Undo',
            run: () => {
              state.savedLoops.splice(i, 0, gone);
              renderSavedLoops();
              persistSong();
            },
          },
        });
        return;
      }
      setLoopBars(l.start, l.end);
      setLooping(true, true);
      seekToBar(l.start);
    };
    host.append(li);
  });
}
function saveCurrentLoop() {
  const l = state.loop;
  if (!l) {
    toast('Select some bars first');
    return;
  }
  if (state.savedLoops.some((s) => s.start === l.start && s.end === l.end)) {
    toast('That loop is already saved');
    return;
  }
  const si = sectionAt(l.start);
  const section = si >= 0 && state.sections[si].startBar === l.start && state.sections[si].endBar === l.end ? state.sections[si].name : '';
  state.savedLoops.push({ ...l, name: section || `Passage ${state.savedLoops.length + 1}` });
  state.savedLoops.sort((a, b) => a.start - b.start);
  renderSavedLoops();
  persistSong();
  toast(`Saved loop: bars ${l.start + 1}–${l.end + 1}`);
}
$('saveLoopBtn').onclick = saveCurrentLoop;
const addNoteHere = () => {
  if (!api.score) return;
  if (isPlaying()) setPlaying(false);
  barNotes.add(Math.max(0, state.currentBar));
};
$('addNoteBtn').onclick = (e) => {
  e.stopPropagation();
  addNoteHere();
};

// ---------------------------------------------------------------------------
// Speed, trainer, pitch, metronome, count-in, volume
// ---------------------------------------------------------------------------

function setSpeed(pct: number, quiet = false) {
  pct = Math.max(25, Math.min(200, Math.round(pct)));
  state.speed = pct;
  api.playbackSpeed = pct / 100;
  $<HTMLInputElement>('speed').value = String(pct);
  updateSpeedLabel();
  if (state.trainer) updateTrainerLabel();
  if (!quiet) {
    toast(`Speed ${pct}%`, { key: 'speed' });
    persistSong();
  }
}

let currentOriginalTempo = 0;
function updateSpeedLabel() {
  const bpm = currentOriginalTempo ? ` · ♩${Math.round((currentOriginalTempo * state.speed) / 100)}` : '';
  $('speedLabel').textContent = `${state.speed}%${bpm}`;
  $('speedLabel').classList.toggle('changed', state.speed !== 100);
}

$<HTMLInputElement>('speed').oninput = (e) => setSpeed(Number((e.target as HTMLInputElement).value));
$('speed').ondblclick = () => setSpeed(100);
$('speedPresets').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]');
  if (!b) return;
  setSpeed(Number(b.dataset.speed));
  closePopups();
});

$('trainerBtn').onclick = (e) => {
  e.stopPropagation();
  state.trainer = !state.trainer;
  $('trainerBtn').classList.toggle('on', state.trainer);
  closePopups(state.trainer ? 'trainerPop' : undefined);
  $('trainerPop').classList.toggle('open', state.trainer);
  if (state.trainer) {
    setLooping(true, true);
    setSpeed(Number($<HTMLInputElement>('trStart').value));
    if (!api.playbackRange) toast('Trainer on: drag across some bars to choose what to loop', { ms: 3500 });
  }
  updateTrainerLabel();
};
/** While the trainer runs its button shows where it is: "70% → 100%". */
function updateTrainerLabel() {
  const target = Number($<HTMLInputElement>('trTarget').value) || 100;
  const label = $('trainerBtn').querySelector('span')!;
  label.textContent = state.trainer ? `${state.speed}% → ${target}%` : 'Trainer';
  $('trainerBtn').classList.toggle('show-label', state.trainer);
}
$('trTarget').addEventListener('input', updateTrainerLabel);
$('trainerPop').onclick = (e) => e.stopPropagation();

function onLoopWrapped() {
  // A full pass of the loop just finished at the current speed: log it for the progress charts.
  if (state.loop) practiceLog.recordPass(state.loop.start, state.loop.end, state.speed);
  state.loopPasses++;
  renderLoopPasses();
  if (!state.trainer) return;
  const step = Number($<HTMLInputElement>('trStep').value) || 5;
  const target = Number($<HTMLInputElement>('trTarget').value) || 100;
  if (state.speed < target) {
    setSpeed(Math.min(target, state.speed + step), true);
    toast(state.speed >= target ? `Target reached: ${state.speed}%` : `Next pass: ${state.speed}%`, { key: 'speed' });
  }
  updateTrainerLabel();
}

function setPitch(n: number, quiet = false) {
  state.pitch = Math.max(-12, Math.min(12, n));
  if (api.score) api.changeTrackTranspositionPitch(api.score.tracks, state.pitch);
  updatePitchUi();
  if (!quiet) {
    toast(state.pitch ? `Playback pitch ${fmtSemis(state.pitch)} semitone${Math.abs(state.pitch) > 1 ? 's' : ''}` : 'Playback at written pitch', { key: 'pitch' });
    persistSong();
  }
}
$('pitchDown').onclick = () => setPitch(state.pitch - 1);
$('pitchUp').onclick = () => setPitch(state.pitch + 1);

function updatePitchUi() {
  $('pitchLabel').textContent = fmtSemis(state.pitch);
  $('pitchLabel').classList.toggle('changed', state.pitch !== 0);
  // Alternate whole-neck tunings (E♭ standard, D standard, F standard…) can be played along on a
  // standard-tuned guitar by shifting the playback; suggest the shift.
  const tip = $('tuningTip');
  const track = api.score?.tracks[state.fbTrack];
  const tun = track ? tuningInfo(track) : null;
  if (!tun || !tun.offset) {
    tip.hidden = true;
    return;
  }
  tip.hidden = false;
  const want = -tun.offset;
  if (state.pitch === want) {
    tip.innerHTML = `<span class="ok">✓</span> Playback now matches a standard-tuned guitar.`;
  } else {
    tip.innerHTML = `<b>${escapeHtml(tun.name)}</b> — no guitar in that tuning? Either shift playback ${fmtSemis(want)} and play the same frets in standard, or re-tab the frets for standard to match the recording's pitch.<div class="tip-actions"><button class="link-btn" data-a="pitch">Shift playback ${fmtSemis(want)}</button><button class="link-btn" data-a="retab">Re-tab for standard</button></div>`;
    tip.querySelector<HTMLElement>('[data-a="pitch"]')!.onclick = () => setPitch(want);
    const std = PRESETS.find((p) => p.tuning.length === track!.staves[0].tuning.length && /Standard/.test(p.name));
    const rb = tip.querySelector<HTMLElement>('[data-a="retab"]')!;
    if (std) rb.onclick = () => applyRetab(tuningKey(std.tuning));
    else rb.remove();
  }
}

function setCountIn(on: boolean, quiet = true) {
  state.countIn = on;
  prefs.countIn = on;
  persistPrefs();
  // alphaTab 1.8.4 locks up if a count-in is requested while the embedded audio track is playing,
  // so the count-in only ever reaches the player in synth mode.
  api.countInVolume = on && !state.useBackingTrack ? 1 : 0;
  $('countInBtn').classList.toggle('on', on && !state.useBackingTrack);
  if (!quiet) toast(on ? 'Count-in on' : 'Count-in off', { key: 'countin' });
}
function setMetronome(on: boolean, quiet = true) {
  state.metronome = on;
  prefs.metronome = on;
  persistPrefs();
  api.metronomeVolume = on ? 1 : 0;
  $('metroBtn').classList.toggle('on', on);
  if (!quiet) toast(on ? 'Metronome on' : 'Metronome off', { key: 'metro' });
}
$('countInBtn').onclick = () => setCountIn(!state.countIn, false);
$('metroBtn').onclick = () => setMetronome(!state.metronome, false);
setCountIn(state.countIn);
setMetronome(state.metronome);

$<HTMLInputElement>('masterVol').value = String(prefs.volume);
api.masterVolume = prefs.volume / 100;
$<HTMLInputElement>('masterVol').oninput = (e) => {
  prefs.volume = Number((e.target as HTMLInputElement).value);
  api.masterVolume = prefs.volume / 100;
  persistPrefs();
};

function setPanel(cls: 'show-fretboard' | 'show-overview' | 'show-chords', btn: string, on: boolean) {
  app.classList.toggle(cls, on);
  $(btn).classList.toggle('on', on);
}
function toggleFretboard() {
  prefs.fretboard = !app.classList.contains('show-fretboard');
  setPanel('show-fretboard', 'fretBtn', prefs.fretboard);
  persistPrefs();
}
function toggleOverview() {
  prefs.overview = !app.classList.contains('show-overview');
  setPanel('show-overview', 'overviewBtn', prefs.overview);
setPanel('show-chords', 'chordsBtn', prefs.chords);
  persistPrefs();
}
$('fretBtn').onclick = toggleFretboard;
$('overviewBtn').onclick = toggleOverview;

// Audio source: the MIDI synth, or a real recording (embedded in a GP8 file, or loaded by you).
function updateSourceButton() {
  const has = !!api.score?.backingTrack;
  $('sourceBtn').hidden = !has;
  if (!has && state.useBackingTrack) state.useBackingTrack = false;
  $('sourceBtn').classList.toggle('on', state.useBackingTrack);
  const real = state.recording ? 'Your recording' : 'Original audio';
  $('sourceLabel').textContent = state.useBackingTrack ? real : 'MIDI synth';
  $('sourceBtn').title = state.useBackingTrack ? 'Playing the recording · click for the MIDI synth' : `Playing the MIDI synth · click for ${real.toLowerCase()}`;
  $<HTMLButtonElement>('countInBtn').disabled = state.useBackingTrack;
  $('countInBtn').title = state.useBackingTrack ? 'Count-in is only available with the MIDI synth' : 'Count-in before playback (C)';
  setCountIn(state.countIn);
}
function setSource(recording: boolean, quiet = false) {
  if (recording && !api.score?.backingTrack) return;
  // Wait mode mutes your part in the synth; a recording already contains it.
  if (recording && waitMode.active) setWait(false);
  state.useBackingTrack = recording;
  api.stop();
  api.settings.player.playerMode = recording ? alphaTab.PlayerMode.EnabledBackingTrack : alphaTab.PlayerMode.EnabledSynthesizer;
  api.updateSettings();
  api.loadMidiForScore();
  updateSourceButton();
  if (!quiet) toast(recording ? `Playing ${state.recording ? 'your recording' : 'the original recording'}` : 'Playing the MIDI synth');
}
$('sourceBtn').onclick = () => setSource(!state.useBackingTrack);

// ---------------------------------------------------------------------------
// Your recording: load, tap-sync, nudge
// ---------------------------------------------------------------------------

function renderRecording() {
  const info = $('recInfo');
  const rec = state.recording;
  if (!rec) {
    info.innerHTML = `<span class="empty-note">${state.original?.backing ? 'This file has its own recording. Load another to use yours instead.' : 'Play along with the real song: load an audio file, then tap to sync it to the tab.'}</span>`;
    return;
  }
  info.innerHTML = `<div class="rec-name">${ICONS.note}<span></span></div><div class="rec-sync">${escapeHtml(describeSync(rec.sync))}</div><div class="rec-actions"><button class="link-btn" id="recSync">Sync…</button><button class="link-btn danger" id="recRemove">Remove</button></div>`;
  info.querySelector('.rec-name span')!.textContent = rec.name;
  $('recSync').onclick = () => openSync();
  $('recRemove').onclick = () => {
    if (!api.score || !state.original) return;
    const removed = rec;
    const key = state.songKey;
    detach(api.score, state.original);
    deleteRecording(key);
    state.recording = null;
    if (state.useBackingTrack) setSource(!!api.score.backingTrack, true);
    api.updateSyncPoints();
    updateSourceButton();
    renderRecording();
    toast('Recording removed', {
      ms: 6000,
      action: {
        label: 'Undo',
        run: () => {
          if (!api.score || state.songKey !== key) return;
          state.recording = removed;
          attach(api.score, removed);
          saveRecording(removed);
          api.updateSyncPoints();
          updateSourceButton();
          renderRecording();
        },
      },
    });
  };
}
$('recLoadBtn').onclick = () => $<HTMLInputElement>('recInput').click();
$<HTMLInputElement>('recInput').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !api.score) return;
  const rec: Recording = { key: state.songKey, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), sync: startOnly(0) };
  state.recording = rec;
  attach(api.score, rec);
  saveRecording(rec);
  setSource(true, true);
  renderRecording();
  openSync();
};

// Tap mode plays the file directly (not through alphaTab, whose playback stops at the end of the
// score) so long intros can be reached, and so tap times come straight from the audio clock.
const sync = { tapping: false, taps: [] as number[], audio: null as HTMLAudioElement | null, url: '', timer: 0 };
function applySync(points: Recording['sync']) {
  const rec = state.recording;
  if (!rec || !api.score) return;
  rec.sync = points;
  api.score.applyFlatSyncPoints(points);
  api.updateSyncPoints();
  saveRecording(rec);
  renderRecording();
  $('syncStatus').textContent = `Sync: ${describeSync(points)}`;
}
function openSync() {
  if (!state.recording) return;
  closePopups();
  if (!state.useBackingTrack) setSource(true, true);
  $('syncName').textContent = `· ${state.recording.name}`;
  $('syncStatus').textContent = `Sync: ${describeSync(state.recording.sync)}`;
  $('tapCount').textContent = '';
  $('syncModal').hidden = false;
}
function closeSync() {
  if (sync.tapping) stopTapping();
  $('syncModal').hidden = true;
}
const tapClock = () => (sync.audio ? sync.audio.currentTime * 1000 : 0);
function startTapping() {
  const rec = state.recording;
  if (!rec) return;
  setPlaying(false);
  sync.url = URL.createObjectURL(new Blob([rec.bytes as BlobPart]));
  sync.audio = new Audio(sync.url);
  sync.audio.play().catch(() => toast('The browser blocked audio playback; tap Start again'));
  sync.taps = [];
  sync.tapping = true;
  $('tapStart').textContent = 'Stop';
  $<HTMLButtonElement>('tapPad').disabled = false;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-skip]')) b.disabled = false;
  const tick = () => {
    if (!sync.tapping) return;
    if (!sync.taps.length) $('tapCount').textContent = `${(tapClock() / 1000).toFixed(1)}s · tap on bar 1`;
    sync.timer = requestAnimationFrame(tick);
  };
  tick();
}
function tap() {
  if (!sync.tapping) return;
  const ms = tapClock();
  // Taps must move forward in time (skipping back with −5s would otherwise scramble the order).
  if (sync.taps.length && ms <= sync.taps[sync.taps.length - 1]) return;
  sync.taps.push(ms);
  $('tapCount').textContent = `Bar ${sync.taps.length} at ${(ms / 1000).toFixed(2)}s`;
  const pad = $('tapPad');
  pad.classList.remove('hit');
  void pad.offsetWidth;
  pad.classList.add('hit');
}
function stopTapping() {
  sync.tapping = false;
  cancelAnimationFrame(sync.timer);
  sync.audio?.pause();
  sync.audio = null;
  URL.revokeObjectURL(sync.url);
  $('tapStart').textContent = 'Start again';
  $<HTMLButtonElement>('tapPad').disabled = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-skip]')) b.disabled = true;
  const order = api.tickCache?.masterBars.map((m) => m.masterBar.index) ?? [];
  const points = sync.taps.length > 1 ? syncFromTaps(sync.taps, order) : sync.taps.length ? startOnly(sync.taps[0]) : state.recording!.sync;
  applySync(points);
  $('tapCount').textContent = sync.taps.length ? `${sync.taps.length} bar${sync.taps.length > 1 ? 's' : ''} synced` : 'No taps: sync unchanged';
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-skip]'))
  b.onclick = () => {
    if (sync.audio) sync.audio.currentTime = Math.max(0, sync.audio.currentTime + Number(b.dataset.skip));
  };
$('tapStart').onclick = () => (sync.tapping ? stopTapping() : startTapping());
$('tapPad').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tap();
});
$('syncPreview').onclick = () => {
  if (sync.tapping) stopTapping();
  api.stop();
  setPlaying(true);
};
for (const b of document.querySelectorAll<HTMLElement>('[data-nudge]'))
  b.onclick = () => state.recording && applySync(shift(state.recording.sync, Number(b.dataset.nudge)));
$('syncClose').onclick = closeSync;
$('syncModal').onclick = (e) => e.target === $('syncModal') && closeSync();

// ---------------------------------------------------------------------------
// Transport & position
// ---------------------------------------------------------------------------

$('playBtn').onclick = togglePlay;
$('stopBtn').onclick = stopPlayback;
$('prevBar').onclick = () => stepBar(-1);
$('nextBar').onclick = () => stepBar(1);

api.playerStateChanged.on((e) => {
  const playing = e.state === alphaTab.synth.PlayerState.Playing;
  app.classList.toggle('playing', playing);
  practiceLog.setPlaying(playing);
  keepAwake(playing);
  if (playing && state.countIn && !state.useBackingTrack) showCountIn();
  if (!playing) {
    stopCountIn();
    persistSong();
    updateGoalRing();
  }
});

// Big "1 2 3 4" over the sheet while the count-in clicks.
function showCountIn() {
  stopCountIn();
  const lookup = masterBarAtTick(api.tickPosition);
  if (!lookup) return;
  const mb = lookup.masterBar;
  const beatMs = (60000 / (lookup.tempo * api.playbackSpeed)) * (4 / mb.timeSignatureDenominator);
  const el = $('countIn');
  for (let i = 0; i < mb.timeSignatureNumerator; i++) {
    countInTimers.push(
      window.setTimeout(() => {
        el.textContent = String(i + 1);
        el.classList.remove('beat');
        void el.offsetWidth;
        el.classList.add('beat');
      }, 120 + i * beatMs),
    );
  }
  countInTimers.push(window.setTimeout(stopCountIn, 120 + mb.timeSignatureNumerator * beatMs));
}
function stopCountIn() {
  countInTimers.forEach(clearTimeout);
  countInTimers = [];
  $('countIn').classList.remove('beat');
}

function masterBarAtTick(tick: number) {
  const cache = api.tickCache;
  if (!cache) return null;
  const bars = cache.masterBars;
  let lo = 0;
  let hi = bars.length - 1;
  let found = null as (typeof bars)[number] | null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].start <= tick) {
      found = bars[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function seekToBar(barIndex: number) {
  const cache = api.tickCache;
  const score = api.score;
  if (!cache || !score) return;
  const mb = score.masterBars[barIndex];
  if (!mb) return;
  markUserSeek();
  api.tickPosition = cache.getMasterBarStart(mb);
}

function stepBar(dir: number) {
  const lookup = masterBarAtTick(api.tickPosition);
  if (!lookup) return;
  const cache = api.tickCache!;
  const idx = cache.masterBars.indexOf(lookup);
  // "Previous" first returns to the start of the current bar if we're well into it.
  const target = dir < 0 && api.tickPosition - lookup.start > 240 ? idx : idx + dir;
  const next = cache.masterBars[Math.max(0, Math.min(cache.masterBars.length - 1, target))];
  markUserSeek();
  api.tickPosition = next.start;
}

let lastPersistAt = 0;

api.playerPositionChanged.on((e) => {
  if (transport.starting && !e.isSeek && isPlaying()) transport.starting = false;
  waitMode.onPosition(e.currentTick, isPlaying(), e.isSeek);
  const lengthChanged = state.endTick !== (e.endTick || 1);
  state.endTick = e.endTick || 1;
  state.endTime = e.endTime;
  if (lengthChanged) {
    updateScrubRange();
    const len = document.getElementById('songLength');
    if (len) len.textContent = fmtTime(e.endTime * api.playbackSpeed);
  }
  const range = api.playbackRange;
  if (state.looping && range && e.currentTick < state.lastTick - 480 && Math.abs(e.currentTick - range.startTick) < 1920 && performance.now() - userSeekAt > 400) {
    onLoopWrapped();
  }
  state.lastTick = e.currentTick;
  if (e.originalTempo && e.originalTempo !== currentOriginalTempo) {
    currentOriginalTempo = e.originalTempo;
    updateSpeedLabel();
  }

  $('timeCur').textContent = fmtTime(e.currentTime);
  $('timeEnd').textContent = fmtTime(e.endTime);
  if (!state.scrubbing) setScrubVisual(e.currentTick / state.endTick);

  const lookup = masterBarAtTick(e.currentTick);
  if (lookup) {
    const mb: MasterBar = lookup.masterBar;
    overview.setPlayhead(mb.index + Math.min(1, (e.currentTick - lookup.start) / Math.max(1, lookup.end - lookup.start)));
    $('posTempo').textContent = `${Math.round(lookup.tempo * api.playbackSpeed)}`;
    if (mb.index !== state.currentBar) {
      state.currentBar = mb.index;
      $('posBar').textContent = `${mb.index + 1} / ${api.score!.masterBars.length}`;
      $('posSig').textContent = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
      const si = sectionAt(mb.index);
      $('posSection').textContent = si >= 0 ? state.sections[si].name : '–';
      refreshSectionChips();
      const note = isPlaying() ? barNotes.forBar(mb.index)[0] : null;
      if (note) toast(`Bar ${mb.index + 1}: ${note.text}`, { key: 'barnote', ms: 3500 });
      if (performance.now() - lastPersistAt > 3000) {
        lastPersistAt = performance.now();
        persistSong();
      }
    }
  }
});

// Scrubber
function setScrubVisual(ratio: number) {
  const r = Math.max(0, Math.min(1, ratio));
  const pct = `${r * 100}%`;
  $('scrubFill').style.width = pct;
  $('scrubThumb').style.left = pct;
  // Screen-reader value: only touch the attributes when the whole percent changes.
  const whole = Math.round(r * 100);
  if (whole !== state.scrubPct) {
    state.scrubPct = whole;
    const el = $('scrub');
    el.setAttribute('aria-valuenow', String(whole));
    el.setAttribute('aria-valuetext', `${fmtTime(r * state.endTime)} of ${fmtTime(state.endTime)}`);
  }
}
function scrubTo(clientX: number, commit: boolean) {
  const r = scrub.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  setScrubVisual(ratio);
  $('timeCur').textContent = fmtTime(ratio * state.endTime);
  if (commit) {
    markUserSeek();
    api.tickPosition = Math.round(ratio * state.endTick);
  }
}
scrub.addEventListener('pointerdown', (e) => {
  state.scrubbing = true;
  scrub.setPointerCapture(e.pointerId);
  scrubTo(e.clientX, true);
});
scrub.addEventListener('pointermove', (e) => state.scrubbing && scrubTo(e.clientX, false));
scrub.addEventListener('pointerup', (e) => {
  if (!state.scrubbing) return;
  state.scrubbing = false;
  scrubTo(e.clientX, true);
});
function updateScrubRange() {
  const range = api.playbackRange;
  const el = $('scrubRange');
  if (!range) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${(range.startTick / state.endTick) * 100}%`;
  el.style.width = `${((range.endTick - range.startTick) / state.endTick) * 100}%`;
}

// Click a note while paused to hear it (and see it on the fretboard).
api.noteMouseDown.on((note: Note) => {
  if (!isPlaying()) api.playNote(note);
});
api.beatMouseDown.on((beat: Beat) => {
  if (!isPlaying() && app.classList.contains('show-fretboard')) showFretboardBeats([beat]);
});

// ---------------------------------------------------------------------------
// Fretboard
// ---------------------------------------------------------------------------

function setupFretboard() {
  const score = api.score;
  if (!score) return;
  let track = score.tracks[state.focusTrack];
  if (!tuningInfo(track)) track = state.visibleTracks.map((i) => score.tracks[i]).find((t) => tuningInfo(t)) ?? track;
  const staff = track.staves[0];
  const tun = tuningInfo(track);
  const trackChanged = state.fbTrack !== track.index;
  state.fbTrack = track.index;
  setupChords();
  updateRetabUi();
  if (waitMode.active && trackChanged) moveWaitMute();
  if (!tun) {
    $('fbTrack').textContent = `${track.name} has no fretboard`;
    fretboard.setup(['E', 'B', 'G', 'D', 'A', 'E'], 0);
    fretboard.show([]);
    return;
  }
  $('fbTrack').innerHTML = `<i style="background:${trackColor(track.index)}"></i>${escapeHtml(track.name)} · ${escapeHtml(tun.name)}${tun.capo ? ` · capo ${tun.capo}` : ''}`;
  fretboard.setup(staff.tuning.map(noteName), staff.capo);
  fretboard.onNoteClick = (s, fret) => {
    const midi = staff.tuning[s] + fret + state.pitch;
    pluck(midi);
    return noteName(midi);
  };
  fretboard.show([]);
}

// ---------------------------------------------------------------------------
// Chord sheet
// ---------------------------------------------------------------------------

let chordList: ChordList | null = null;
let currentChord = '';
function setupChords() {
  const track = api.score?.tracks[state.fbTrack];
  const strip = $('chordsStrip');
  strip.replaceChildren();
  currentChord = '';
  chordList = track ? collectChords(track) : null;
  $('chordsTrack').innerHTML = track ? `<i style="background:${trackColor(track.index)}"></i>${escapeHtml(track.name)}` : '';
  if (!track || !chordList?.length) {
    strip.innerHTML = '<div class="empty-note">No chords in this track (needs chord diagrams in the file, or beats with three or more notes).</div>';
    return;
  }
  const staff = track.staves[0];
  for (const c of chordList) {
    const card = document.createElement('button');
    card.className = 'chord-card';
    card.dataset.key = c.key;
    card.title = `${c.name || 'Unnamed shape'} · used ${c.count}× · first in bar ${c.first.voice.bar.index + 1}${c.fromFile ? '' : ' (from the tab)'}`;
    card.innerHTML = `<span class="chord-name${c.name ? '' : ' unknown'}">${escapeHtml(c.name || '?')}</span><span class="chord-count">${c.count}×</span>`;
    card.append(chordDiagram(c));
    card.onclick = () => {
      // Strum low → high, then jump to the first place the chord is used.
      const notes = c.pitches.map((p, i) => (p >= 0 ? p : c.frets[i] >= 0 ? staff.tuning[i] + c.frets[i] + staff.capo : -1)).filter((p) => p >= 0).reverse();
      notes.forEach((p, i) => setTimeout(() => pluck(p + state.pitch, 0.5), i * 28));
      if (api.tickCache) {
        markUserSeek();
        api.tickPosition = api.tickCache.getBeatStart(c.first);
      }
      markChord(c.key);
      // Show the whole shape on the fretboard (opening it if needed).
      if (!app.classList.contains('show-fretboard')) toggleFretboard();
      fretboard.show(
        c.frets
          .map((f, i) => (f < 0 ? null : { string: i, fret: f, kind: 'normal' as const, held: false, label: noteName(staff.tuning[i] + f + staff.capo) }))
          .filter((n): n is NonNullable<typeof n> => !!n),
      );
    };
    strip.append(card);
  }
}
function markChord(key: string) {
  if (key === currentChord) return;
  currentChord = key;
  for (const card of $('chordsStrip').querySelectorAll<HTMLElement>('.chord-card')) {
    const on = card.dataset.key === key;
    card.classList.toggle('current', on);
    if (on) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}
function toggleChords() {
  prefs.chords = !app.classList.contains('show-chords');
  setPanel('show-chords', 'chordsBtn', prefs.chords);
  persistPrefs();
}
$('chordsBtn').onclick = toggleChords;

// ---------------------------------------------------------------------------
// Re-tab for another tuning
// ---------------------------------------------------------------------------

const tuningKey = (t: number[]) => t.join(',');
function updateRetabUi() {
  const sel = $<HTMLSelectElement>('retabSelect');
  const track = api.score?.tracks[state.fbTrack];
  const staff = track?.staves[0];
  sel.replaceChildren();
  if (!track || !staff || staff.isPercussion || !staff.isStringed) {
    sel.disabled = true;
    sel.append(new Option('—', ''));
    return;
  }
  sel.disabled = false;
  const orig = originalTuning(track);
  const origInfo = tuningInfo(track);
  sel.append(new Option(`As written${isRetabbed(track) ? '' : origInfo ? ` · ${origInfo.name}` : ''}`, ''));
  for (const p of PRESETS) {
    if (p.tuning.length !== orig.length || tuningKey(p.tuning) === tuningKey(orig)) continue;
    sel.append(new Option(p.name, tuningKey(p.tuning)));
  }
  sel.value = isRetabbed(track) ? tuningKey(staff.tuning) : '';
}
function applyRetab(value: string) {
  const score = api.score;
  const track = score?.tracks[state.fbTrack];
  if (!score || !track) return;
  if (!value) {
    restoreTab(track);
    delete state.retab[track.index];
    toast(`${track.name}: back to the tab as written`);
  } else {
    const target = value.split(',').map(Number);
    const r = retab(track, target);
    state.retab[track.index] = target;
    const name = PRESETS.find((p) => tuningKey(p.tuning) === value)?.name ?? 'new tuning';
    const extra = [r.octaveUp ? `${r.octaveUp} out-of-range notes raised an octave` : '', r.harmonicsChanged ? `${r.harmonicsChanged} natural harmonics can't keep their pitch` : '', r.unplaced ? `${r.unplaced} notes have no free string` : '']
      .filter(Boolean)
      .join('; ');
    toast(`Re-tabbed ${track.name} for ${name}: ${r.moved} notes moved${extra ? ` (${extra})` : ''}`, { ms: 4500 });
  }
  persistSong();
  api.renderTracks(state.visibleTracks.map((i) => score.tracks[i]));
  buildTrackList();
  buildSongInfo(score);
  setupFretboard();
  updatePitchUi();
}
$<HTMLSelectElement>('retabSelect').onchange = (e) => applyRetab((e.target as HTMLSelectElement).value);

const HT = alphaTab.model.HarmonicType;
function fretNotes(beat: Beat, held = false): FretNote[] {
  const staff = beat.voice.bar.staff;
  const out: FretNote[] = [];
  for (const n of beat.notes) {
    if (n.fret < 0 || n.string < 1) continue;
    out.push({
      string: staff.tuning.length - n.string,
      fret: n.fret,
      kind: n.isDead ? 'dead' : n.harmonicType !== HT.None ? 'harmonic' : n.isGhost ? 'ghost' : 'normal',
      held: held || n.isTieDestination,
      label: noteName(n.realValue),
    });
  }
  return out;
}

function showFretboardBeats(beats: Beat[]) {
  const current: FretNote[] = [];
  let anchor: Beat | null = null;
  for (const beat of beats) {
    const staff = beat.voice.bar.staff;
    if (staff.track.index !== state.fbTrack || staff.index !== 0) continue;
    current.push(...fretNotes(beat));
    if (beat.voice.index === 0) anchor = beat;
  }
  // Preview the next thing to play on this track (skipping rests), like a lookahead in Rocksmith.
  let next = anchor?.nextBeat ?? null;
  for (let i = 0; next && i < 8 && (next.isRest || !next.notes.length); i++) next = next.nextBeat;
  const upcoming = next && !next.isRest ? fretNotes(next).filter((n) => !n.held) : [];
  fretboard.show(current, upcoming);
}

// ---------------------------------------------------------------------------
// View: stave profile, layout, zoom, theme, sidebar
// ---------------------------------------------------------------------------

function segmentedMark(id: string, v: string) {
  $(id).querySelectorAll<HTMLElement>('button').forEach((x) => x.classList.toggle('active', x.dataset.value === v));
}
function segmented(id: string, value: string, onChange: (v: string) => void) {
  segmentedMark(id, value);
  $(id).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    segmentedMark(id, b.dataset.value!);
    onChange(b.dataset.value!);
  });
}

function setView(v: string) {
  prefs.view = v as typeof prefs.view;
  persistPrefs();
  segmentedMark('viewMode', v);
  segmentedMark('viewModeM', v);
  api.settings.display.staveProfile = v === 'tab' ? SP.Tab : v === 'score' ? SP.Score : SP.Default;
  api.updateSettings();
  api.render();
}
function setLayout(v: string) {
  prefs.layout = v as typeof prefs.layout;
  persistPrefs();
  segmentedMark('layoutMode', v);
  segmentedMark('layoutModeM', v);
  const horizontal = v === 'horizontal';
  api.settings.display.layoutMode = horizontal ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
  app.classList.toggle('layout-horizontal', horizontal);
  applyFollow();
  api.render();
}
// The phone layout has no room in the top bar, so the Display menu carries copies of these.
for (const id of ['viewMode', 'viewModeM']) segmented(id, prefs.view, setView);
for (const id of ['layoutMode', 'layoutModeM']) segmented(id, prefs.layout, setLayout);
app.classList.toggle('layout-horizontal', prefs.layout === 'horizontal');

function applyAppTheme() {
  const root = document.documentElement;
  if (prefs.appTheme === 'auto') delete root.dataset.appTheme;
  else root.dataset.appTheme = prefs.appTheme;
  const light = prefs.appTheme === 'light' || (prefs.appTheme === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#181b20');
  requestAnimationFrame(() => overview.draw());
}
segmented('appTheme', prefs.appTheme, (v) => {
  prefs.appTheme = v as typeof prefs.appTheme;
  persistPrefs();
  applyAppTheme();
});
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppTheme);
applyAppTheme();

segmented('themeSwatches', prefs.theme, (v) => {
  prefs.theme = v as typeof prefs.theme;
  persistPrefs();
  applyTheme(api.settings, prefs.theme);
  api.updateSettings();
  api.render();
});
segmented('toneMode', activeTone(), (v) => {
  if (v === 'studio' && !hasStudioBank) {
    toast('Studio sounds aren\'t installed. Run "npm run fetch-sounds" and reload.', { ms: 4000 });
    segmentedMark('toneMode', 'basic');
    return;
  }
  prefs.tone = v as Tone;
  persistPrefs();
  applyToneChoice();
});
function applyToneChoice() {
  const t = activeTone();
  // Swapping sound banks mid-note cuts the audio; stop cleanly first.
  if (isPlaying()) setPlaying(false);
  segmentedMark('toneMode', t);
  loadSoundBank(t).then((ok) => ok && toast(t === 'studio' ? 'Studio tone: full sound bank with room reverb' : 'Basic MIDI: dry General MIDI sound', { key: 'tone' }));
}
if (!hasStudioBank) $('toneMode').querySelector('[data-value="studio"]')!.setAttribute('title', 'Run "npm run fetch-sounds" to install');

segmented('fbLabels', prefs.fbLabels, (v) => {
  prefs.fbLabels = v as typeof prefs.fbLabels;
  persistPrefs();
  fretboard.setOptions({ labels: prefs.fbLabels });
});
function applyFollow() {
  const horizontal = prefs.layout === 'horizontal';
  api.settings.player.scrollMode = !prefs.follow
    ? alphaTab.ScrollMode.Off
    : horizontal && !prefersReducedMotion()
      ? alphaTab.ScrollMode.Smooth
      : alphaTab.ScrollMode.Continuous;
  api.updateSettings();
}
$<HTMLInputElement>('followToggle').checked = prefs.follow;
$<HTMLInputElement>('followToggle').onchange = (e) => {
  prefs.follow = (e.target as HTMLInputElement).checked;
  persistPrefs();
  applyFollow();
  toast(prefs.follow ? 'Sheet follows playback' : 'Sheet stays put: scroll freely while it plays');
};

$<HTMLInputElement>('leftyToggle').checked = prefs.lefty;
$<HTMLInputElement>('leftyToggle').onchange = (e) => {
  prefs.lefty = (e.target as HTMLInputElement).checked;
  persistPrefs();
  fretboard.setOptions({ lefty: prefs.lefty });
};

function setZoom(z: number) {
  prefs.zoom = Math.max(50, Math.min(200, z));
  persistPrefs();
  showZoom();
  api.settings.display.scale = prefs.zoom / 100;
  api.updateSettings();
  api.render();
}
const showZoom = () => document.querySelectorAll('.zoom-label').forEach((el) => (el.textContent = `${prefs.zoom}%`));
showZoom();
for (const id of ['zoomIn', 'zoomInM']) $(id).onclick = () => setZoom(prefs.zoom + 10);
for (const id of ['zoomOut', 'zoomOutM']) $(id).onclick = () => setZoom(prefs.zoom - 10);

const DRAWER_QUERY = '(max-width: 1100px)';
// Pinch to zoom the sheet on touch screens: scale the page live, re-engrave when the fingers lift.
{
  const pts = new Map<number, { x: number; y: number }>();
  let startDist = 0;
  let startZoom = 100;
  let pinching = false;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const paper = $('paper');
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      pinching = true;
      startDist = dist();
      startZoom = prefs.zoom;
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching || pts.size !== 2) return;
    paper.style.transformOrigin = 'top center';
    paper.style.transform = `scale(${Math.max(0.5, Math.min(2, dist() / startDist))})`;
  });
  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const factor = pts.size === 2 && pinching ? dist() / startDist : 1;
    pts.delete(e.pointerId);
    if (!pinching) return;
    pinching = false;
    paper.style.transform = '';
    const z = Math.round((startZoom * factor) / 5) * 5;
    if (z !== prefs.zoom) setZoom(z);
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
}

function toggleSidebar() {
  if (window.matchMedia(DRAWER_QUERY).matches) {
    app.classList.toggle('sidebar-open');
    return;
  }
  prefs.sidebar = !prefs.sidebar;
  persistPrefs();
  app.classList.toggle('sidebar-collapsed', !prefs.sidebar);
}
app.classList.toggle('sidebar-collapsed', !prefs.sidebar);
$('sidebarToggle').onclick = toggleSidebar;
// On phones/tablets the sidebar is a drawer over the sheet: tapping the sheet closes it.
document.querySelector('.stage')!.addEventListener('pointerdown', () => app.classList.remove('sidebar-open'));

$('printBtn').onclick = () => {
  closePopups();
  // Always print black on white, whatever sheet theme is on screen.
  const p = THEMES.paper;
  api.print(undefined, {
    display: { resources: { mainGlyphColor: '#000000', secondaryGlyphColor: '#00000066', staffLineColor: p.staff, barSeparatorColor: '#000000', barNumberColor: p.barNum, scoreInfoColor: '#000000' } },
  });
};
$('backupBtn').onclick = () => {
  closePopups();
  persistSong();
  practiceLog.flush();
  const backup = makeBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `tab-trainer-backup-${backup.exportedAt.slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Saved a backup of ${Object.keys(backup.data).length} items (loops, notes, practice log, settings). Recordings aren't included.`, { ms: 5000 });
};
$('restoreBtn').onclick = () => {
  closePopups();
  $<HTMLInputElement>('restoreInput').click();
};
$<HTMLInputElement>('restoreInput').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const n = restoreBackup(JSON.parse(await file.text()));
    toast(`Restored ${n} items. Reloading…`, { ms: 2000 });
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(`Couldn't restore: ${(err as Error).message}`, { ms: 5000 });
  }
};
$('midiBtn').onclick = () => {
  closePopups();
  api.downloadMidi();
};

function passageName(start: number, end: number) {
  const saved = state.savedLoops.find((l) => l.start === start && l.end === end);
  if (saved) return saved.name;
  const section = state.sections.find((x) => x.startBar === start && x.endBar === end);
  if (section) return section.name;
  return start === end ? `Bar ${start + 1}` : `Bars ${start + 1}–${end + 1}`;
}
function setProgress(open: boolean) {
  closePopups();
  $('progressModal').hidden = !open;
  if (!open) return;
  $('progressSong').textContent = api.score ? `· ${api.score.title || state.fileName}` : '';
  practiceLog.render($('progressBody'), passageName);
  const goal = $<HTMLInputElement>('pgGoal');
  goal.value = String(prefs.dailyGoal);
  goal.onchange = () => {
    prefs.dailyGoal = Math.max(5, Math.min(240, Math.round(Number(goal.value) || 20)));
    persistPrefs();
    updateGoalRing();
  };
}

// Daily goal ring in the top bar: fills as today's practice time grows.
function updateGoalRing() {
  const mins = practiceLog.todayMs() / 60000;
  const frac = Math.min(1, mins / prefs.dailyGoal);
  const c = 2 * Math.PI * 15;
  $('goalFill').setAttribute('stroke-dasharray', `${(frac * c).toFixed(1)} ${c.toFixed(1)}`);
  $('goalText').textContent = frac >= 1 ? '✓' : String(Math.floor(mins));
  $('goalRing').classList.toggle('done', frac >= 1);
  $('goalRing').title = `Today: ${Math.floor(mins)} of ${prefs.dailyGoal} min practised`;
  $('goalRing').setAttribute('aria-label', $('goalRing').title);
  if (frac >= 1 && !goalCelebrated && mins - prefs.dailyGoal < 1) toast(`Daily goal reached: ${prefs.dailyGoal} minutes. Nice work!`, { ms: 4000 });
  if (frac >= 1) goalCelebrated = true;
}
$('goalRing').onclick = () => setProgress(true);
updateGoalRing();
setInterval(updateGoalRing, 15000);
$('progressBtn').onclick = () => setProgress(true);
$('progressMenuBtn').onclick = () => setProgress(true);
$('progressClose').onclick = () => setProgress(false);
$('progressModal').onclick = (e) => e.target === $('progressModal') && setProgress(false);

// ---------------------------------------------------------------------------
// Foot pedals (Bluetooth page turners act as keyboards)
// ---------------------------------------------------------------------------

const PEDAL_ACTIONS: [PedalAction, string][] = [
  ['playpause', 'Play / pause'],
  ['restart', 'Back to loop start'],
  ['prev', 'Previous bar'],
  ['next', 'Next bar'],
  ['loop', 'Loop on / off'],
  ['nextchunk', 'Next passage (move loop)'],
  ['slower', 'Slower (−5%)'],
  ['faster', 'Faster (+5%)'],
  ['none', 'Do nothing'],
];
function runPedal(action: PedalAction) {
  const run: Record<PedalAction, () => void> = {
    playpause: togglePlay,
    restart: () => {
      markUserSeek();
      if (api.playbackRange) api.tickPosition = api.playbackRange.startTick;
      else stopPlayback();
    },
    prev: () => stepBar(-1),
    next: () => stepBar(1),
    loop: () => setLooping(!state.looping),
    nextchunk: () => moveLoop(1),
    slower: () => setSpeed(state.speed - 5),
    faster: () => setSpeed(state.speed + 5),
    none: () => {},
  };
  run[action]();
}
let learningPedal: 'left' | 'right' | null = null;
const keyLabel = (k: string) => k.replace(/^Arrow/, '').replace(/^Key/, '') || k;
function renderPedals() {
  for (const side of ['left', 'right'] as const) {
    const btn = document.querySelector<HTMLButtonElement>(`[data-pedal="${side}"]`)!;
    btn.textContent = learningPedal === side ? 'Press pedal…' : keyLabel(prefs.pedals[side].key);
    btn.classList.toggle('learning', learningPedal === side);
    const sel = document.querySelector<HTMLSelectElement>(`[data-pedal-action="${side}"]`)!;
    if (!sel.options.length) for (const [v, label] of PEDAL_ACTIONS) sel.append(new Option(label, v));
    sel.value = prefs.pedals[side].action;
  }
}
for (const side of ['left', 'right'] as const) {
  document.querySelector<HTMLButtonElement>(`[data-pedal="${side}"]`)!.onclick = () => {
    learningPedal = learningPedal === side ? null : side;
    renderPedals();
  };
  document.querySelector<HTMLSelectElement>(`[data-pedal-action="${side}"]`)!.onchange = (e) => {
    prefs.pedals[side].action = (e.target as HTMLSelectElement).value as PedalAction;
    persistPrefs();
  };
}
renderPedals();

// ---------------------------------------------------------------------------
// Installable, offline app
// ---------------------------------------------------------------------------

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
  $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  closePopups();
  await installPrompt?.prompt();
  installPrompt = null;
  $('installBtn').hidden = true;
};
// Opening a .gp file with the installed app (desktop Chrome/Edge file handling).
type LaunchParams = { files: { getFile(): Promise<File> }[] };
(window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue?.setConsumer(async (p) => {
  const file = await p.files[0]?.getFile();
  if (file) loadBytes(new Uint8Array(await file.arrayBuffer()), file.name, true);
});

// ---------------------------------------------------------------------------
// Music-stand mode (tablets): full screen, just the sheet and a floating mini transport.
// The screen is kept awake while playing in any mode.
// ---------------------------------------------------------------------------

async function keepAwake(on: boolean) {
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } };
  try {
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  // The browser drops wake locks when the tab is hidden; take it again on return.
  wakeLock = null;
  if (!document.hidden && isPlaying()) keepAwake(true);
});

function setStand(on: boolean) {
  app.classList.toggle('stand', on);
  closePopups();
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    toast('Music-stand mode: tap ✕ or press Esc to leave', { ms: 2500 });
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  updateStandBar();
}
function updateStandBar() {
  $('standSpeed').textContent = `${state.speed}%`;
  $('standLoop').classList.toggle('on', state.looping);
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && app.classList.contains('stand')) setStand(false);
});
$('standBtn').onclick = () => setStand(true);
$('standExit').onclick = () => setStand(false);
$('standPlay').onclick = togglePlay;
$('standPrev').onclick = () => stepBar(-1);
$('standNext').onclick = () => stepBar(1);
$('standLoop').onclick = () => {
  setLooping(!state.looping);
  updateStandBar();
};
$('standSlower').onclick = () => {
  setSpeed(state.speed - 5);
  updateStandBar();
};
$('standFaster').onclick = () => {
  setSpeed(state.speed + 5);
  updateStandBar();
};

// ---------------------------------------------------------------------------
// Wait mode & tuner (microphone)
// ---------------------------------------------------------------------------

let waitMuted: { track: number; wasMuted: boolean } | null = null;
async function ensureMic() {
  if (listener.running) return true;
  try {
    await listener.start();
    return true;
  } catch (err) {
    toast(micErrorMessage(err), { ms: 7000 });
    return false;
  }
}
/** Say why the microphone failed, so the fix is obvious (site permission, OS permission, no mic, http). */
function micErrorMessage(err: unknown) {
  const name = (err as DOMException)?.name ?? '';
  const msg = String((err as Error)?.message ?? '');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return `The microphone only works over https or on localhost — this page is on ${location.host}.`;
  if (name === 'NotAllowedError' && /system/i.test(msg))
    return 'Your computer is blocking this browser from the microphone. Allow it in System Settings → Privacy & Security → Microphone, then reload.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was blocked for this site. Allow it in the address bar\'s site settings (Safari: Safari → Settings for This Website), then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in (or pick an input in your system sound settings) and try again.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The microphone is busy or blocked by the system. Close other apps using it and try again.';
  return `Microphone unavailable${name ? ` (${name}${msg ? `: ${msg}` : ''})` : ''}.`;
}
function releaseMic() {
  if (!waitMode.active && $('tunerModal').hidden) listener.stop();
}
function muteForWait(on: boolean) {
  const score = api.score;
  if (!score) return;
  if (on) {
    const t = score.tracks[state.fbTrack];
    waitMuted = { track: t.index, wasMuted: t.playbackInfo.isMute };
    api.changeTrackMute([t], true);
  } else if (waitMuted) {
    const t = score.tracks[waitMuted.track];
    if (t && !waitMuted.wasMuted) api.changeTrackMute([t], false);
    waitMuted = null;
  }
}
function moveWaitMute() {
  muteForWait(false);
  muteForWait(true);
  waitMode.build();
}
async function setWait(on: boolean) {
  if (!api.score) return;
  if (on && !(await ensureMic())) return;
  if (on) {
    if (state.useBackingTrack) setSource(false, true);
    muteForWait(true);
    waitMode.start();
    toast(`Wait mode: ${api.score.tracks[state.fbTrack].name} is muted. You play it; playback waits for each note.`, { ms: 4000 });
  } else {
    waitMode.stop();
    muteForWait(false);
    releaseMic();
  }
  app.classList.toggle('wait-on', on);
  $('waitBtn').classList.toggle('on', on);
}
$('waitBtn').onclick = () => setWait(!waitMode.active);

function describeTarget(beat: Beat) {
  const staff = beat.voice.bar.staff;
  const notes = beat.notes.filter((n) => n.fret >= 0 && !n.isDead && !n.isTieDestination);
  const names = notes.map((n) => noteName(n.realValue + state.pitch));
  const where = notes.length === 1 ? ` · string ${staff.tuning.length - notes[0].string + 1}, ${notes[0].fret ? `fret ${notes[0].fret}` : 'open'}` : '';
  return `${names.join(' ')}${where}`;
}
function renderWaitStatus(s: WaitStatus) {
  const pill = $('waitPill');
  if (!waitMode.active) {
    pill.classList.remove('show', 'waiting');
    return;
  }
  pill.classList.add('show');
  pill.classList.toggle('waiting', !!s.waiting);
  const stats = `<span class="wp-heard" title="What the microphone hears"><span class="wp-level"></span>hearing <i>–</i></span><span class="wp-stats"><b>${s.inTime}</b> in time · <b>${s.waited}</b> waited</span>`;
  if (s.waiting) {
    pill.innerHTML = `<span class="wp-dot"></span>Your turn: <b>${escapeHtml(describeTarget(s.waiting.beat))}</b>${stats}`;
    if (app.classList.contains('show-fretboard')) fretboard.show(fretNotes(s.waiting.beat));
  } else if (s.next) {
    pill.innerHTML = `<span class="wp-mic"></span>Listening · next <b>${escapeHtml(describeTarget(s.next.beat))}</b>${stats}`;
  } else {
    pill.innerHTML = `<span class="wp-mic"></span>Listening${stats}`;
  }
}

// Live "hearing" readout, so it's obvious whether the mic picks up your guitar and which note.
let hearingAt = 0;
function renderWaitHearing(r: PitchReading) {
  const el = document.querySelector<HTMLElement>('#waitPill .wp-heard');
  const now = performance.now();
  if (!el || now - hearingAt < 80) return;
  hearingAt = now;
  const clear = r.clarity > 0.85 && !Number.isNaN(r.midi);
  const heard = Math.round(r.midi);
  el.style.setProperty('--level', Math.min(1, Math.sqrt(r.rms / 0.08)).toFixed(2));
  el.querySelector('i')!.textContent = clear ? noteName(heard) : '–';
  const t = waitMode.current;
  el.classList.toggle('match', !!t && clear && t.pitches.some((p) => (heard - state.pitch - p) % 12 === 0));
}

// Tuner
let tunerStrings: number[] = [];
function setTuner(open: boolean) {
  closePopups();
  $('tunerModal').hidden = !open;
  if (!open) return releaseMic();
  const track = api.score?.tracks[state.fbTrack];
  const staff = track?.staves[0];
  const tun = track ? tuningInfo(track) : null;
  tunerStrings = staff && tun ? [...staff.tuning].reverse().map((m) => m + staff.capo) : [40, 45, 50, 55, 59, 64];
  $('tunerTuning').textContent = tun ? `· ${tun.name}${tun.capo ? ` · capo ${tun.capo}` : ''}` : '· Standard';
  const host = $('tunerStrings');
  host.replaceChildren();
  tunerStrings.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'tuner-string';
    b.innerHTML = `<b>${noteName(m)}</b><span>${tunerStrings.length - i}</span>`;
    b.title = `Play reference ${noteName(m)}`;
    b.onclick = () => pluck(m);
    host.append(b);
  });
  if (!$('tunerTicks').childElementCount) {
    for (let c = -50; c <= 50; c += 10) {
      const a = (c / 50) * (Math.PI / 2.6);
      const [x1, y1, x2, y2] = [150 + Math.sin(a) * 112, 150 - Math.cos(a) * 112, 150 + Math.sin(a) * (c % 50 === 0 || c === 0 ? 98 : 104), 150 - Math.cos(a) * (c % 50 === 0 || c === 0 ? 98 : 104)];
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      Object.entries({ x1, y1, x2, y2, class: 'td-tick' }).forEach(([k, v]) => l.setAttribute(k, String(v)));
      $('tunerTicks').append(l);
    }
  }
  ensureMic().then((ok) => !ok && setTuner(false));
}
let smoothCents = 0;
function renderTuner(r: PitchReading) {
  const note = $('tunerNote');
  if (!r.freq || r.clarity < 0.8) {
    $('tunerCents').textContent = r.rms < 0.006 ? 'Play a string' : 'Listening…';
    return;
  }
  const nearest = Math.round(r.midi);
  const cents = (r.midi - nearest) * 100;
  smoothCents = smoothCents * 0.6 + cents * 0.4;
  note.textContent = noteName(nearest);
  const inTune = Math.abs(smoothCents) < 5;
  $('tunerCents').textContent = inTune ? `In tune · ${r.freq.toFixed(1)} Hz` : `${smoothCents > 0 ? '+' : '−'}${Math.abs(smoothCents).toFixed(0)} cents ${smoothCents > 0 ? 'sharp' : 'flat'} · ${r.freq.toFixed(1)} Hz`;
  $('tunerModal').classList.toggle('in-tune', inTune);
  const angle = (Math.max(-50, Math.min(50, smoothCents)) / 50) * (180 / 2.6);
  $('tunerNeedle').setAttribute('transform', `rotate(${angle} 150 150)`);
  let closest = 0;
  tunerStrings.forEach((m, i) => Math.abs(r.midi - m) < Math.abs(r.midi - tunerStrings[closest]) && (closest = i));
  $('tunerStrings').querySelectorAll('.tuner-string').forEach((b, i) => b.classList.toggle('near', i === closest && Math.abs(r.midi - tunerStrings[closest]) < 1.5));
}
$('tunerMenuBtn').onclick = () => setTuner(true);
$('fbTunerBtn').onclick = () => setTuner(true);
$('tunerClose').onclick = () => setTuner(false);
$('tunerModal').onclick = (e) => e.target === $('tunerModal') && setTuner(false);

$('tipsClose').onclick = () => {
  $('tips').hidden = true;
  prefs.seenTips = true;
  persistPrefs();
};
$('tipsMore').onclick = () => {
  $('tipsClose').click();
  setHelp(true);
};

function setHelp(open: boolean) {
  $('helpModal').hidden = !open;
  closePopups();
}
$('helpBtn').onclick = () => setHelp(true);
$('shortcutHint').onclick = () => setHelp(true);
$('helpClose').onclick = () => setHelp(false);
$('helpModal').onclick = (e) => e.target === $('helpModal') && setHelp(false);

function setAbout(open: boolean) {
  $('aboutModal').hidden = !open;
  closePopups();
}
$('aboutBtn').onclick = () => setAbout(true);
$('aboutClose').onclick = () => setAbout(false);
$('aboutModal').onclick = (e) => e.target === $('aboutModal') && setAbout(false);

setPanel('show-fretboard', 'fretBtn', prefs.fretboard);
setPanel('show-overview', 'overviewBtn', prefs.overview);
setPanel('show-chords', 'chordsBtn', prefs.chords);

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** Keys typed into a text field, dropdown or editor belong to that control, not to shortcuts. */
function isTextEntry(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes((t as HTMLInputElement).type);
}
const anyPopupOpen = () => [...POPUPS.map(([, m]) => m), 'trainerPop'].some((m) => $(m).classList.contains('open'));

window.addEventListener('keydown', (e) => {
  if (learningPedal) {
    e.preventDefault();
    if (e.key !== 'Escape') {
      prefs.pedals[learningPedal].key = e.key;
      persistPrefs();
      toast(`${learningPedal === 'left' ? 'Left' : 'Right'} pedal set to ${keyLabel(e.key)}`);
    }
    learningPedal = null;
    renderPedals();
    return;
  }
  // Escape always closes the open dialog, even when focus is inside one of its fields.
  if (e.key === 'Escape') {
    const close: [string, () => void][] = [
      ['helpModal', () => setHelp(false)],
      ['aboutModal', () => setAbout(false)],
      ['tunerModal', () => setTuner(false)],
      ['syncModal', () => closeSync()],
      ['progressModal', () => setProgress(false)],
    ];
    const open = close.find(([id]) => !$(id).hidden);
    if (open) {
      e.preventDefault();
      open[1]();
      return;
    }
  }
  if (isTextEntry(e.target)) return;
  const pedal = (['left', 'right'] as const).find((side) => prefs.pedals[side].key === e.key && prefs.pedals[side].action !== 'none');
  if (pedal && !e.repeat && api.score) {
    e.preventDefault();
    runPedal(prefs.pedals[pedal].action);
    return;
  }
  // A focused slider keeps its own arrow keys.
  if ((e.target as HTMLInputElement).type === 'range' && e.key.startsWith('Arrow')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.shiftKey && e.key.startsWith('Arrow') && $('helpModal').hidden && api.score) {
    e.preventDefault();
    if (e.key === 'ArrowRight') resizeLoop(1);
    else if (e.key === 'ArrowLeft') resizeLoop(-1);
    else if (e.key === 'ArrowDown') moveLoop(1);
    else moveLoop(-1);
    return;
  }
  if (!$('helpModal').hidden) {
    if (e.key === 'Escape' || e.key === '?') setHelp(false);
    return;
  }
  if (!$('tunerModal').hidden) {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'u') setTuner(false);
    return;
  }
  if (!$('syncModal').hidden) {
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) tap();
    } else if (e.key === 'Escape') closeSync();
    return;
  }
  if (!$('progressModal').hidden) {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') setProgress(false);
    return;
  }
  const actions: Record<string, () => void> = {
    ' ': togglePlay,
    Enter: stopPlayback,
    ArrowLeft: () => stepBar(-1),
    ArrowRight: () => stepBar(1),
    '[': () => setSpeed(state.speed - 5),
    ']': () => setSpeed(state.speed + 5),
    ',': () => setPitch(state.pitch - 1),
    '.': () => setPitch(state.pitch + 1),
    l: () => setLooping(!state.looping),
    s: saveCurrentLoop,
    m: () => setMetronome(!state.metronome, false),
    c: () => setCountIn(!state.countIn, false),
    f: toggleFretboard,
    o: toggleOverview,
    k: toggleChords,
    x: () => api.score && editSection(Math.max(0, state.currentBar)),
    n: addNoteHere,
    p: () => setProgress(true),
    w: () => setWait(!waitMode.active),
    u: () => setTuner(true),
    t: () => {
      if (!hasStudioBank) return;
      prefs.tone = activeTone() === 'studio' ? 'basic' : 'studio';
      persistPrefs();
      applyToneChoice();
    },
    b: toggleSidebar,
    '-': () => setZoom(prefs.zoom - 10),
    '=': () => setZoom(prefs.zoom + 10),
    '+': () => setZoom(prefs.zoom + 10),
    '?': () => setHelp(true),
    '1': () => loopBarsFromHere(1),
    '2': () => loopBarsFromHere(2),
    '4': () => loopBarsFromHere(4),
    '8': () => loopBarsFromHere(8),
    Escape: () => {
      if (anyPopupOpen()) return closePopups();
      if (app.classList.contains('sidebar-open')) return app.classList.remove('sidebar-open');
      if (app.classList.contains('stand')) return setStand(false);
      if (api.playbackRange) clearLoop();
    },
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? actions[e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

// ---------------------------------------------------------------------------
// Boot: ?file=<name> opens a demo (or, locally, a sample) directly (handy for links & testing)
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const wanted = params.get('file');
if (wanted) {
  const hit = library.find((e) => e.name === wanted || e.name.toLowerCase().includes(wanted.toLowerCase()));
  if (hit) loadUrl(hit.url, hit.name);
}
if (params.get('fretboard') === '1' && !prefs.fretboard) toggleFretboard();

installA11y();

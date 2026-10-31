# Tab Trainer

A practice-focused Guitar Pro reader for the browser. It opens `.gp` (GP7/8), `.gpx` (GP6) and older `.gp3/.gp4/.gp5` files, engraves them as standard notation and tab, and plays them back through a General MIDI synth.

Parsing, engraving and synthesis come from [alphaTab](https://www.alphatab.net) (MPL-2.0). Tab Trainer adds the practice UI around it.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints. Drop a file on the window, use **Open file**, or pick from **Songs**: the bundled demo songs, plus (when running locally) anything you put in `samples/`. `?file=<name>` opens a song directly, and `&fretboard=1` starts with the fretboard showing.

## Features

- **Notation:** Score + Tab, Tab only (with rhythm stems) or Score only; page layout or single-line layout with smooth scrolling; zoom (also pinch on touch screens); Paper, Sepia and Night sheet themes. A light/dark/auto interface theme, and a follow-playback toggle so you can read ahead while it plays. Guitar techniques render and play: natural/artificial/pinch harmonics, slides, bends, hammer-ons/pull-offs, tapping, vibrato, palm mute, let ring, dead and ghost notes, whammy, tremolo picking, plus dynamics, tempo changes, chord diagrams and text.
- **Tone:** *Studio* uses the GeneralUser GS sound bank (sampled clean, overdriven and distorted guitars, bass, drums) with room reverb and gentle compression. *Basic MIDI* is the dry General MIDI sound for clean, analytic listening. Press `T` to switch.
- **Tracks:** each track gets its own colour and a light that flashes while it plays, and shows its tuning (named presets, plus derived names like "F Standard", "Drop C♯" or "Nashville") and capo. Each track has view/stack, mute, solo and volume controls.
- **Arrangement overview:** a track × bar map along the bottom, with sections, notes, tempo changes, the playhead and the loop range. Click a bar to jump there, or drag across bars to loop them.
- **Sections:** the file's rehearsal marks plus your own (`X` marks a section at the current bar), shown as chips and on the overview. With Loop on, clicking a section loops it.
- **Playback:** a scrub bar, previous/next bar, and click-to-seek. While paused, clicking a note plays it. Speed runs from 25% to 200% (with presets), with count-in, metronome and master volume.
- **Chord sheet (`K`):** diagrams of every chord shape in the track, taken from the file or derived from the tab and named automatically. The current chord is highlighted as it plays; click one to hear it, see it on the fretboard and jump to it.
- **Looping and practice:** drag-to-loop, section loops and saved loops. `1`/`2`/`4`/`8` loop that many bars from here, `⇧←`/`⇧→` shrink or grow the loop, and `⇧↑`/`⇧↓` step to the previous or next passage. A speed trainer raises the tempo each pass. Pin **bar notes** (`N`), which pop up as reminders during playback.
- **Practice progress (`P`):** minutes per day and per song, a practice streak, and each passage's best full-pass speed over time, as charts plus a table. A daily-goal ring in the top bar fills as you practise.
- **Alternate tunings:** pitch-shift playback ±12 semitones, or **re-tab** a track for another tuning (Standard, Drop D, E♭/D Standard, DADGAD, open tunings, 7-string, bass). Re-tabbing keeps every pitch and only changes the frets.
- **Live fretboard:** shows the notes sounding now and dashed rings for what comes next. It can label notes by name or fret number, flip for left-handed players, and plays any note you click on it (string names give open-string references).
- **Microphone:**
  - **Tuner (`U`):** shows the note, cents sharp or flat, and the nearest string.
  - **Wait mode (`W`):** mutes your part and pauses at each of your notes until it hears you play it, tallying notes played in time against notes it had to wait for. Detection is monophonic, so any chord tone counts for a chord.
- **Play along with a recording:** load an MP3/M4A of the song, tap Space on beat 1 of each bar to sync it (with ±5 s skips for long intros), then nudge. Loops and speed changes then apply to the real recording. GP8 files with embedded audio work the same way.
- **Phones and tablets:** a responsive layout with touch-sized controls, plus **music-stand mode**: full screen, just the sheet and a floating transport. The screen stays awake while playing. The installed app respects the notch and home indicator. (On iPhone the ring/silent switch mutes playback, as for most web audio.)
- **Accessibility:** keyboard-operable throughout, labelled controls, proper dialogs, and 4.5:1 text contrast in both themes. It honours reduced-motion, and axe-core reports zero violations.
- **Foot pedals:** Bluetooth page turners default to PageUp = back to loop start and PageDown = play/pause; either pedal can be re-taught and re-assigned in Display options.
- **Installable and offline:** a web app manifest plus a service worker, so once installed it opens offline with your recent songs and the sound bank. It also accepts .gp files opened from the OS.
- **Remembers your practice:** per song, it keeps speed, pitch, tracks, mixer, loop, saved loops, notes, sections, re-tab, your recording and sync, and your last bar. Deletes can be undone. **Back up / restore** (⋯ menu) moves all of it between browsers or devices; recordings excluded. The Songs list shows real titles, artists and minutes practised, with search.
- **Export:** print / save as PDF, and MIDI export.

Press `?` in the app for all keyboard shortcuts.

## On a phone or iPad

- **Quick test on the same Wi-Fi:** run `npm run dev -- --host` and open the "Network" URL on the device. Everything works except installing and offline use, which iOS only allows on an HTTPS site.
- **Full app:** publish it (see [Publishing on GitHub Pages](#publishing-on-github-pages)) and open the https address. In Safari, use **Share → Add to Home Screen**, and open it once online.

## Songs: demos and your own files

- **`demos/`** holds the songs that ship with the app: *Greensleeves* (traditional) and *Ode to Joy* (Beethoven), both public-domain melodies, plus *Drop D Groove*, an original exercise. The arrangements were written for this project and are dedicated to the public domain (CC0). They are written as alphaTex text in `demos/src/`; `npm run demos` turns them into the `.gp` files (checking every bar's length and that the file reads back unchanged).
- **`samples/`** is for your own Guitar Pro files. They show up in the Songs list when you run the app locally, but the folder is ignored by git and a build never includes it, because tabs of published songs are usually copyrighted. `scripts/check-dist.mjs` double-checks a build contains no songs other than the demos; the deploy workflow runs it before publishing.

## Publishing on GitHub Pages

The repository includes a workflow (`.github/workflows/pages.yml`) that, on every push to `main`, downloads the Studio sound bank, type-checks and tests, builds, checks that only the demo songs are included, and publishes `dist/`.

1. **Create a public repository on GitHub**, e.g. `tab-trainer` (GitHub Pages is free for public repositories). Leave it empty.
2. **Push a clean copy.** This project's early commits contain personal sample tabs, so don't push the existing history. Start a fresh branch with a single commit instead (your local history stays as it is):
   ```bash
   git checkout --orphan release
   git add -A                      # samples/ is ignored, so it stays out
   git commit -m "Tab Trainer"
   git remote add origin https://github.com/<you>/tab-trainer.git
   git push -u origin release:main
   ```
   From then on, work on the `release` branch and `git push`.
3. **Turn Pages on:** in the repository, **Settings → Pages → Build and deployment → Source: GitHub Actions**. The push triggers the first deploy (see the **Actions** tab).
4. **Open it** at `https://<you>.github.io/tab-trainer/`. The app works from that sub-address: the workflow sets `BASE_PATH` to `/<repo>/` (or `/` for a `<you>.github.io` repository or a custom domain with `public/CNAME`).

To try a Pages-style build locally: `BASE_PATH=/tab-trainer/ npm run build && node scripts/check-dist.mjs`.

## Demo recordings

`scripts/record.mjs` drives the app in headless Chromium and writes an MP4 with the app's own audio. Frames come from the DevTools screencast, and audio is tapped from the page's AudioContext and media elements. Scenarios live in `scripts/scenarios.mjs`.

```bash
npx playwright-core install chromium   # once
npx vite --port 5180 --host 127.0.0.1 &
node scripts/record.mjs goose recordings/goose.mp4
```

Scenarios: `goose`, `letThereBeLight`, `nonsense`, `letThereBeLightGpx`, `practiceTools`, `altTuning`, `toneAB`, `featureTour`, `overnightTour`. Recordings use a dark colour scheme (`SCHEME=light` for light).

`scripts/compat.mjs <outDir> <files…>` checks files load, render and make sound, and saves a screenshot of each.

## Checks

```bash
npm run check                          # type-check + unit tests (vitest, run against demos/ and, if present, samples/)
node scripts/fuzz.mjs 60 1             # random-interaction fuzz test (PHONE=1 for a phone viewport)
node scripts/a11y-check.mjs            # axe-core accessibility audit
node tests/e2e/wait-mode.mjs /tmp      # wait mode with a synthesised microphone
node tests/e2e/dialogs.mjs             # dialogs take focus and close with Escape
```

## Known alphaTab 1.8.4 quirks worked around

- Subscribing to `api.midiLoaded` crashes the page (the worker synth's `loadedMidiInfo` getter recurses), so the song length is read from `playerPositionChanged` instead.
- A count-in while an embedded audio track plays locks up the player, so count-in is disabled in original-audio mode.
- `pause()` snaps the cursor back to the start of the bar, and calling it from inside a position event rewinds to the song start. Wait mode defers its pause and then moves the cursor onto the note.
- Tick-cache beat slices are relative to their bar's start.
- The audio output starts asynchronously; a pause or stop before it has started breaks the output. All transport requests go through one gate that waits for playback to start.
- Loading a sound bank by URL stalls silently on a network error, so banks are fetched by the app (with progress) and passed in as bytes, falling back to Basic MIDI.

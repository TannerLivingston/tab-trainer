// Demo scripts for scripts/record.mjs. Each `run` drives the page while it is being recorded.
const LTBL = encodeURIComponent('LET THERE BE LIGHT Guitar Tab 6 String');

export const scenarios = {
  goose: {
    query: '?file=Goose&fretboard=1',
    async run({ wait, key, click, clickAt, caption, barPoint }) {
      await caption('Goose — Polyphia  ·  .gpx (Guitar Pro 6)');
      await wait(2500);
      await click('#playBtn');
      await caption('Notation + tab with harmonics, tapping, slides and let-ring, all played back');
      await wait(9000);
      await caption('Live fretboard shows what is sounding right now');
      await wait(12000);
      await caption('Click anywhere on the sheet to move the playhead');
      await clickAt(await barPoint(40, 0.08));
      await wait(9000);
      await caption('Slow it down: speed 100% → 65%');
      for (let i = 0; i < 7; i++) {
        await key('[');
        await wait(120);
      }
      await wait(10000);
      await click('#playBtn');
      await caption(null);
      await wait(800);
    },
  },

  letThereBeLight: {
    query: `?file=${LTBL}.gp`,
    async run({ wait, key, click, clickAt, drag, caption, barPoint, page }) {
      await caption('Let There Be Light — Polyphia  ·  .gp (Guitar Pro 7), two guitar tracks');
      await wait(2000);
      await click('.track[data-index="1"] .track-eye');
      await caption('Show both guitars stacked on the sheet');
      await wait(2500);
      await caption('Click bar 41, where the two guitars split into different parts');
      await clickAt(await barPoint(40, 0.05, 0.85));
      await wait(1200);
      await click('#playBtn');
      await caption('Both guitars');
      await wait(8000);
      await click('.track[data-index="0"] .mute');
      await caption('Mute Tim: only Scott plays');
      await wait(7000);
      await click('.track[data-index="0"] .mute');
      await click('.track[data-index="0"] .solo');
      await caption('Solo Tim: only Tim plays');
      await wait(7000);
      await click('.track[data-index="0"] .solo');
      await caption('Both guitars again');
      await wait(3500);
      await click('#playBtn');
      await caption('Drag across bars 41–42 to loop them');
      await wait(600);
      await drag(await barPoint(40, 0.06, 0.85), await barPoint(41, 0.93, 0.85));
      await wait(1500);
      await caption('Speed trainer: starts at 60% and adds 10% every pass');
      await click('#trainerBtn');
      await page.fill('#trStep', '10');
      await wait(1500);
      await click('.position');
      await key('m');
      await caption('Metronome on. Each loop gets faster…');
      await click('#playBtn');
      await wait(26000);
      await click('#playBtn');
      await caption(null);
      await wait(800);
    },
  },

  nonsense: {
    query: '?file=Nonsense&fretboard=1',
    async run({ wait, click, caption }) {
      await caption('Nonsense  ·  .gp (Guitar Pro 8), custom tuning F B♭ E♭ A♭ C F');
      await wait(2500);
      await click('#viewMode button[data-value="tab"]');
      await caption('Tab-only view with rhythm stems');
      await wait(2000);
      await click('#countInBtn');
      await caption('Count-in on, then play');
      await click('#playBtn');
      await wait(19000);
      await click('#playBtn');
      await caption('This file also embeds the original recording. Switch to it:');
      await wait(1200);
      await click('#sourceBtn');
      await wait(1500);
      await click('#stopBtn');
      await click('#playBtn');
      await caption('Original audio, synced to the tab');
      await wait(11000);
      await click('#playBtn');
      await click('#sourceBtn');
      await caption('Back to the MIDI synth');
      await wait(1500);
      await caption(null);
    },
  },

  letThereBeLightGpx: {
    query: `?file=${LTBL}.gpx`,
    async run({ wait, key, click, caption }) {
      await caption('Let There Be Light  ·  .gpx (Guitar Pro 6) in single-line view');
      await wait(1500);
      await click('#layoutMode button[data-value="horizontal"]');
      await wait(2000);
      await click('#fretBtn');
      await caption('Bar 5: artificial harmonics (A.H.) and slides');
      for (let i = 0; i < 4; i++) {
        await key('ArrowRight');
        await wait(80);
      }
      await wait(500);
      await click('#playBtn');
      await wait(20000);
      await click('#playBtn');
      await caption(null);
      await wait(600);
    },
  },
};

// v2 feature tours
scenarios.practiceTools = {
  query: `?file=${LTBL}.gp`,
  async run({ wait, key, click, clickAt, drag, caption, page }) {
    const ov = await page.locator('.ov-canvas').boundingBox();
    const barX = (bar) => ov.x + ((bar + 0.5) / 112) * ov.width;
    const ovY = ov.y + 26;
    await caption('New: arrangement overview of every track and bar (bottom)');
    await wait(3000);
    await click('.ov-name[data-index="1"]');
    await caption('Click a track in the overview to view it');
    await wait(2500);
    await click('.track[data-index="0"] .track-eye');
    await caption('Stack both guitars; activity lights show who is playing');
    await wait(2000);
    await key('f');
    await caption('Click a bar in the overview to jump there');
    await clickAt({ x: barX(40), y: ovY });
    await wait(1000);
    await click('#playBtn');
    await caption('Fretboard: solid = sounding now, dashed = coming next');
    await wait(9000);
    await caption('Drag across the overview to loop bars 41–42');
    await drag({ x: barX(40), y: ovY }, { x: barX(41), y: ovY });
    await wait(5500);
    await key('s');
    await caption('S saves the loop to the Practice panel for next time');
    await wait(4500);
    await click('#playBtn');
    await click('#countInBtn');
    await caption('Count-in now shows the beats on screen');
    await wait(600);
    await click('#playBtn');
    await wait(6500);
    await click('#displayBtn');
    await wait(500);
    await click('#themeSwatches button[data-value="night"]');
    await caption('Sheet themes: Paper, Sepia, Night');
    await wait(1200);
    await click('.song-head');
    await wait(5000);
    await click('#playBtn');
    await key('?');
    await caption('Every shortcut on one sheet (press ?)');
    await wait(3000);
    await key('Escape');
    await caption(null);
    await wait(600);
  },
};

scenarios.altTuning = {
  query: '?file=Nonsense&fretboard=1',
  async run({ wait, click, caption, page }) {
    await caption('Nonsense is tuned to F Standard: Tab Trainer spots it');
    await wait(3500);
    await click('#tuningTip .link-btn');
    await caption('One click shifts playback −1 to match a standard-tuned guitar');
    await wait(2500);
    await caption('Click a string name for a tuning reference note');
    for (const s of [5, 4, 3, 2, 1, 0]) {
      await click(`.fb-string-label >> nth=${s}`);
      await wait(650);
    }
    await wait(800);
    await click('#playBtn');
    await caption('Same tab, same frets, now sounding a semitone lower');
    await wait(9000);
    await click('#displayBtn');
    await wait(400);
    await click('#fbLabels button[data-value="frets"]');
    await click('.switch-row');
    await click('.song-head');
    await caption('Fretboard options: fret numbers and left-handed');
    await wait(9000);
    await click('#playBtn');
    await caption(null);
    await wait(600);
  },
};

scenarios.toneAB = {
  query: '?file=Goose',
  async run({ wait, key, click, caption, page }) {
    await caption('Studio tone: sampled guitars + room reverb');
    await wait(1200);
    await click('#playBtn');
    await wait(9000);
    await click('#playBtn');
    await key('Enter');
    await caption('Basic MIDI: the dry sound, for analytic listening (press T)');
    await key('t');
    await page.waitForFunction(() => window.api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 30000 });
    await wait(800);
    await click('#playBtn');
    await wait(9000);
    await click('#playBtn');
    await caption(null);
    await wait(500);
  },
};

// v3: tone, chord sheet, re-tab, bar notes, progress, music-stand mode
scenarios.featureTour = {
  query: '?file=Nonsense',
  async run({ wait, key, click, caption, page }) {
    await caption('Studio tone: sampled guitars with room reverb');
    await wait(800);
    await click('#playBtn');
    await wait(7000);
    await key('t');
    await caption('Press T for Basic MIDI: the dry sound, for analytic listening');
    await page.waitForFunction(() => window.api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 30000 });
    await wait(300);
    await click('#playBtn');
    await wait(6000);
    await click('#playBtn');
    await key('t');
    await page.waitForFunction(() => window.api.isReadyForPlayback && !document.getElementById('loading').classList.contains('show'), null, { timeout: 30000 });
    await key('k');
    await caption('Chord sheet (K): the shapes this song uses; click one to hear it');
    await wait(1200);
    await click('.chord-card >> nth=1');
    await wait(1800);
    await click('.chord-card >> nth=3');
    await wait(2000);
    await caption('Tuned to F Standard? Re-tab it for a standard guitar: same pitches, new frets');
    await page.selectOption('#retabSelect', { label: 'Standard (E)' });
    await wait(3500);
    await key('n');
    await caption('Pin practice notes to bars (N)');
    await wait(500);
    await page.keyboard.type('Let the harmonics ring into bar 5', { delay: 30 });
    await wait(400);
    await page.keyboard.press('Control+Enter');
    await wait(1800);
    await key('Enter');
    await click('#playBtn');
    await caption('Practice time and passage speeds are logged automatically');
    await wait(5000);
    await click('#playBtn');
    await key('p');
    await wait(3500);
    await key('Escape');
    await caption('Music-stand mode for tablets: just the sheet, screen kept awake');
    await click('#standBtn');
    await wait(800);
    await click('#standPlay');
    await wait(6000);
    await click('#standPlay');
    await key('Escape');
    await caption(null);
    await wait(600);
  },
};

// Overnight polish tour: sections, quick loops, light theme, chord shapes, goal ring, library
scenarios.overnightTour = {
  query: '?file=Goose',
  async run({ wait, key, click, caption, page }) {
    await caption('New: a Getting started card on first use');
    await wait(2200);
    await click('#tipsClose');
    for (let i = 0; i < 16; i++) await key('ArrowRight');
    await caption('Press X to mark your own sections (Goose has none in the file)');
    await wait(600);
    await key('x');
    await wait(500);
    await page.keyboard.type('Scott enters', { delay: 40 });
    await page.keyboard.press('Enter');
    await wait(1500);
    await caption('Press 4 to loop four bars from here, then play');
    await key('4');
    await wait(500);
    await click('#playBtn');
    await wait(5000);
    await caption('Shift+↓ moves the loop to the next passage');
    await page.keyboard.press('Shift+ArrowDown');
    await wait(5000);
    await caption('Shift+→ grows the loop by a bar');
    await page.keyboard.press('Shift+ArrowRight');
    await wait(4000);
    await click('#playBtn');
    await caption('Light interface theme (Auto follows your device)');
    await click('#displayBtn');
    await wait(500);
    await click('#appTheme [data-value="light"]');
    await wait(1200);
    await click('.song-head');
    await key('k');
    await caption('Click a chord: hear it and see the shape on the fretboard');
    await wait(1000);
    await click('.chord-card >> nth=1');
    await wait(2500);
    await click('.chord-card >> nth=6');
    await wait(2500);
    await caption("The ring by the logo tracks today's practice toward your daily goal");
    await click('#goalRing');
    await wait(3000);
    await key('Escape');
    await caption('Songs now shows real titles, artists and minutes practised');
    await click('#libraryBtn');
    await wait(3000);
    await key('Escape');
    await caption(null);
    await wait(600);
  },
};

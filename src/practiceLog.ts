import { storageFrozen } from './storage';
// Practice log: minutes played per day (per song), and every completed loop pass with its speed,
// so the Progress view can show time spent and how fast each passage has become.

const GLOBAL_KEY = 'woodshed.log';
const passKey = (song: string) => `woodshed.passages.${song}`;

interface GlobalLog {
  /** date → song key → milliseconds played */
  days: Record<string, Record<string, number>>;
  titles: Record<string, string>;
}
/** "start-end" (0-based bars) → date → best speed and pass count */
type PassageLog = Record<string, Record<string, { best: number; passes: number }>>;

// Dark-mode categorical slots, validated against the panel surface (see dataviz palette check).
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const OTHER = '#4a515b';

const read = <T,>(key: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? 'null') };
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  if (storageFrozen()) return;
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtMin = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class PracticeLog {
  private song = '';
  private playingSince = 0;

  setSong(key: string, title: string) {
    this.flush(true);
    this.song = key;
    const g = read<GlobalLog>(GLOBAL_KEY, { days: {}, titles: {} });
    g.titles[key] = title;
    write(GLOBAL_KEY, g);
  }

  setPlaying(playing: boolean) {
    if (playing && !this.playingSince) this.playingSince = performance.now();
    if (!playing) this.flush(true);
  }

  /** Commit time played so far (called on pause, and periodically while playing). */
  flush(stop = false) {
    if (!this.playingSince || !this.song) return;
    const now = performance.now();
    const ms = now - this.playingSince;
    this.playingSince = stop ? 0 : now;
    const g = read<GlobalLog>(GLOBAL_KEY, { days: {}, titles: {} });
    const d = (g.days[dayKey()] ??= {});
    d[this.song] = (d[this.song] ?? 0) + ms;
    write(GLOBAL_KEY, g);
  }

  /** Milliseconds practised today across all songs, including the session in progress. */
  todayMs() {
    const g = read<GlobalLog>(GLOBAL_KEY, { days: {}, titles: {} });
    const live = this.playingSince ? performance.now() - this.playingSince : 0;
    return Object.values(g.days[dayKey()] ?? {}).reduce((a, b) => a + b, 0) + live;
  }

  /** Total milliseconds practised on a song (all days). */
  static totalFor(songKey: string) {
    const g = read<GlobalLog>(GLOBAL_KEY, { days: {}, titles: {} });
    return Object.values(g.days).reduce((sum, d) => sum + (d[songKey] ?? 0), 0);
  }

  recordPass(start: number, end: number, speed: number) {
    if (!this.song) return;
    const log = read<PassageLog>(passKey(this.song), {});
    const day = ((log[`${start}-${end}`] ??= {})[dayKey()] ??= { best: 0, passes: 0 });
    day.best = Math.max(day.best, speed);
    day.passes++;
    write(passKey(this.song), log);
  }

  /** Fill `host` with the progress view for the current song. */
  render(host: HTMLElement, nameFor: (start: number, end: number) => string) {
    this.flush();
    const g = read<GlobalLog>(GLOBAL_KEY, { days: {}, titles: {} });
    const passages = read<PassageLog>(passKey(this.song), {});
    const today = new Date();
    const total = (date: string) => Object.values(g.days[date] ?? {}).reduce((a, b) => a + b, 0);
    const mine = (date: string) => g.days[date]?.[this.song] ?? 0;

    let week = 0;
    for (let i = 0; i < 7; i++) week += total(dayKey(addDays(today, -i)));
    let streak = 0;
    // A streak survives until the end of today even if you haven't played yet today.
    for (let i = total(dayKey(today)) ? 0 : 1; total(dayKey(addDays(today, -i))) > 0; i++) streak++;
    const songTotal = Object.keys(g.days).reduce((a, d) => a + mine(d), 0);

    const tiles = [
      ['Today', fmtMin(total(dayKey(today)))],
      ['Last 7 days', fmtMin(week)],
      ['Streak', `${streak} day${streak === 1 ? '' : 's'}`],
      ['This song, all time', fmtMin(songTotal)],
    ];
    host.innerHTML = `
      <div class="pg-tiles">${tiles.map(([k, v]) => `<div class="pg-tile"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <label class="pg-goal">Daily goal <input type="number" min="5" max="240" step="5" id="pgGoal" /> minutes</label>
      <section class="pg-chart"><h4>Practice time, last 14 days</h4><div class="pg-legend"><i style="background:${SERIES[0]}"></i>This song<i style="background:${OTHER}"></i>Other songs</div><div class="pg-plot" id="pgTime"></div></section>
      <section class="pg-chart"><h4>Passage speed: best full pass each day</h4><div class="pg-legend" id="pgSpeedLegend"></div><div class="pg-plot" id="pgSpeed"></div></section>
      <section class="pg-table-wrap"><h4>Passages</h4><table class="pg-table" id="pgTable"></table></section>`;

    // --- Chart 1: minutes per day, this song stacked under other songs.
    const days = Array.from({ length: 14 }, (_, i) => dayKey(addDays(today, i - 13)));
    const rows = days.map((d) => ({ d, mine: mine(d) / 60000, other: (total(d) - mine(d)) / 60000 }));
    timeChart(host.querySelector('#pgTime')!, rows);

    // --- Chart 2: best speed per passage per day (top 5 passages by passes).
    const ranked = Object.entries(passages)
      .map(([range, byDay]) => {
        const [s, e] = range.split('-').map(Number);
        return { range, s, e, byDay, passes: Object.values(byDay).reduce((a, b) => a + b.passes, 0) };
      })
      .sort((a, b) => b.passes - a.passes);
    const shown = ranked.slice(0, SERIES.length);
    const speedDays = [...new Set(shown.flatMap((p) => Object.keys(p.byDay)))].sort().slice(-14);
    const series = shown.map((p, i) => ({
      name: nameFor(p.s, p.e),
      color: SERIES[i],
      values: speedDays.map((d) => p.byDay[d]?.best ?? null),
    }));
    host.querySelector('#pgSpeedLegend')!.innerHTML = series.map((s) => `<i style="background:${s.color}"></i>${esc(s.name)}`).join('');
    speedChart(host.querySelector('#pgSpeed')!, speedDays, series);

    // --- Table view of the same data (every passage, not just the charted five).
    const table = host.querySelector('#pgTable')!;
    if (!ranked.length) {
      table.outerHTML = '<p class="empty-note">Loop a passage and play it through: every full pass is logged with its speed.</p>';
    } else {
      table.innerHTML =
        '<thead><tr><th>Passage</th><th>Bars</th><th>Passes</th><th>Best</th><th>Last practised</th></tr></thead><tbody>' +
        ranked
          .map((p) => {
            const ds = Object.keys(p.byDay).sort();
            const best = Math.max(...Object.values(p.byDay).map((v) => v.best));
            return `<tr><td>${esc(nameFor(p.s, p.e))}</td><td>${p.s + 1}–${p.e + 1}</td><td>${p.passes}</td><td>${best}%</td><td>${ds[ds.length - 1]}</td></tr>`;
          })
          .join('') +
        '</tbody>';
    }
  }
}

// ---------------------------------------------------------------------------
// Charts (plain SVG + a hover tooltip)
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Record<string, string | number>) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
const shortDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
function niceMax(v: number) {
  if (v <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

function frame(host: HTMLElement, yMax: number, yFmt: (v: number) => string) {
  const W = 640;
  const H = 180;
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-svg' });
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: i ? 'pg-grid' : 'pg-axis' }));
    const t = svgEl('text', { x: pad.l - 6, y: y + 3.5, 'text-anchor': 'end', class: 'pg-tick' });
    t.textContent = yFmt(v);
    svg.append(t);
  }
  host.replaceChildren(svg);
  const tip = document.createElement('div');
  tip.className = 'pg-tip';
  host.append(tip);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / yMax);
  return { svg, tip, W, H, pad, y };
}

function showTip(host: HTMLElement, tip: HTMLElement, svg: SVGSVGElement, xView: number, html: string) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  const scale = svg.getBoundingClientRect().width / 640;
  const x = xView * scale;
  tip.style.left = `${Math.min(Math.max(x, 70), host.clientWidth - 70)}px`;
}

function timeChart(host: HTMLElement, rows: { d: string; mine: number; other: number }[]) {
  const max = niceMax(Math.max(...rows.map((r) => r.mine + r.other), 1));
  const { svg, tip, W, pad, y } = frame(host, max, (v) => `${Math.round(v)}m`);
  const slot = (W - pad.l - pad.r) / rows.length;
  const bw = Math.min(26, slot - 6);
  rows.forEach((r, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const base = y(0);
    // This song sits on the baseline; other songs stack above with a 2px surface gap.
    if (r.mine > 0) svg.append(svgEl('rect', { x, y: y(r.mine), width: bw, height: Math.max(1, base - y(r.mine)), rx: 3, fill: SERIES[0] }));
    if (r.other > 0) {
      const top = y(r.mine + r.other);
      const bottom = y(r.mine) - (r.mine > 0 ? 2 : 0);
      svg.append(svgEl('rect', { x, y: top, width: bw, height: Math.max(1, bottom - top), rx: 3, fill: OTHER }));
    }
    if (i % 2 === 1 || rows.length <= 7) {
      const t = svgEl('text', { x: x + bw / 2, y: base + 15, 'text-anchor': 'middle', class: 'pg-tick' });
      t.textContent = shortDate(r.d);
      svg.append(t);
    }
    const hit = svgEl('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: base - pad.t, class: 'pg-hit' });
    hit.addEventListener('pointerenter', () =>
      showTip(host, tip, svg as SVGSVGElement, x + bw / 2, `<b>${shortDate(r.d)}</b><br>This song ${Math.round(r.mine)} min<br>Other songs ${Math.round(r.other)} min`),
    );
    svg.append(hit);
  });
  host.addEventListener('pointerleave', () => (tip.style.display = 'none'));
}

function speedChart(host: HTMLElement, days: string[], series: { name: string; color: string; values: (number | null)[] }[]) {
  if (!days.length) {
    host.innerHTML = '<p class="empty-note pg-empty">No looped passages yet. Drag across some bars, loop them, and each full pass is logged here with its speed.</p>';
    return;
  }
  // Round ticks: four steps of a multiple of 10 (0/30/60/90/120 for most songs).
  const top = Math.max(110, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const max = Math.ceil(top / 40) * 40;
  const { svg, tip, W, pad, y } = frame(host, max, (v) => `${Math.round(v)}%`);
  const x = (i: number) => (days.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + 14 + ((W - pad.l - pad.r - 28) * i) / (days.length - 1));
  // Reference: the song's written tempo.
  svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(100), y2: y(100), class: 'pg-ref' }));
  const ref = svgEl('text', { x: W - pad.r - 2, y: y(100) - 4, 'text-anchor': 'end', class: 'pg-tick' });
  ref.textContent = 'full tempo';
  svg.append(ref);
  days.forEach((d, i) => {
    if (days.length > 8 && i % 2) return;
    const t = svgEl('text', { x: x(i), y: y(0) + 15, 'text-anchor': 'middle', class: 'pg-tick' });
    t.textContent = shortDate(d);
    svg.append(t);
  });
  const labels: { x: number; y: number; name: string }[] = [];
  for (const s of series) {
    const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter((p): p is number[] => !!p);
    if (pts.length > 1) svg.append(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    for (const [px, py] of pts) svg.append(svgEl('circle', { cx: px, cy: py, r: 4, fill: s.color, class: 'pg-dot' }));
    if (pts.length) labels.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], name: s.name });
  }
  // With few lines, label each at its last point so identity never rests on colour alone;
  // nudge labels apart vertically so lines that end close together stay readable.
  if (series.length <= 4) {
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const l of labels) {
      const right = l.x > W - 150;
      const t = svgEl('text', { x: right ? l.x - 9 : l.x + 9, y: l.y + 4, 'text-anchor': right ? 'end' : 'start', class: 'pg-label' });
      t.textContent = l.name;
      svg.append(t);
    }
  }
  const cross = svgEl('line', { y1: pad.t, y2: y(0), class: 'pg-cross' });
  svg.append(cross);
  days.forEach((d, i) => {
    const w = days.length === 1 ? W - pad.l - pad.r : (W - pad.l - pad.r - 28) / (days.length - 1);
    const hit = svgEl('rect', { x: x(i) - w / 2, y: pad.t, width: w, height: y(0) - pad.t, class: 'pg-hit' });
    hit.addEventListener('pointerenter', () => {
      cross.setAttribute('x1', String(x(i)));
      cross.setAttribute('x2', String(x(i)));
      cross.style.display = 'block';
      const lines = series
        .filter((s) => s.values[i] !== null)
        .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${s.values[i]}%</b>`)
        .join('');
      showTip(host, tip, svg as SVGSVGElement, x(i), `<b>${shortDate(d)}</b><div class="pg-tip-grid">${lines || '<span>No passes</span>'}</div>`);
    });
    svg.append(hit);
  });
  host.addEventListener('pointerleave', () => {
    tip.style.display = 'none';
    cross.style.display = 'none';
  });
}

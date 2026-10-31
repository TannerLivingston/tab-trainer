// Arrangement overview: one row per track, one column per bar, cells shaded by how busy the bar
// is. Shows the playhead, sections and loop range; click to seek, drag to loop.
import type * as alphaTab from '@coderline/alphatab';

type Score = alphaTab.model.Score;

export const TRACK_COLORS = ['#f2a33a', '#5aa9ff', '#5ccf8a', '#c38cff', '#ff7a9c', '#3fd0c9', '#e6d35a', '#ff8f5a'];

export interface OverviewCallbacks {
  seekBar(bar: number): void;
  loopBars(start: number, end: number): void;
  selectTrack(index: number, toggle: boolean): void;
  describeBar(bar: number): string;
}

interface Section {
  name: string;
  startBar: number;
}

const ROW_H = 16;
const HEAD_H = 16;

export class Overview {
  private names: HTMLElement;
  private canvasWrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private playhead: HTMLElement;
  private loopEl: HTMLElement;
  private dragEl: HTMLElement;
  private hoverEl: HTMLElement;
  private tip: HTMLElement;
  private density: number[][] = [];
  private bars = 0;
  private sections: Section[] = [];
  private noteBars: number[] = [];
  private tempos: { bar: number; bpm: number }[] = [];
  private muted = new Set<number>();
  private visible = new Set<number>();
  private dragStart = -1;

  constructor(
    private host: HTMLElement,
    private cb: OverviewCallbacks,
  ) {
    host.innerHTML = `
      <div class="ov-names"></div>
      <div class="ov-canvas">
        <canvas></canvas>
        <div class="ov-loop"></div>
        <div class="ov-drag"></div>
        <div class="ov-hover"></div>
        <div class="ov-playhead"></div>
        <div class="ov-tip"></div>
      </div>`;
    this.names = host.querySelector('.ov-names')!;
    this.canvasWrap = host.querySelector('.ov-canvas')!;
    this.canvas = host.querySelector('canvas')!;
    this.playhead = host.querySelector('.ov-playhead')!;
    this.loopEl = host.querySelector('.ov-loop')!;
    this.dragEl = host.querySelector('.ov-drag')!;
    this.hoverEl = host.querySelector('.ov-hover')!;
    this.tip = host.querySelector('.ov-tip')!;
    new ResizeObserver(() => this.draw()).observe(this.canvasWrap);
    this.bindPointer();
  }

  setScore(score: Score) {
    this.bars = score.masterBars.length;
    this.density = score.tracks.map((t) =>
      score.masterBars.map((_, i) => {
        let notes = 0;
        for (const staff of t.staves) {
          const bar = staff.bars[i];
          if (!bar) continue;
          for (const v of bar.voices) for (const b of v.beats) notes += b.notes.length;
        }
        return notes;
      }),
    );
    this.names.replaceChildren();
    score.tracks.forEach((t, i) => {
      const row = document.createElement('button');
      row.className = 'ov-name';
      row.dataset.index = String(i);
      row.innerHTML = `<i style="background:${TRACK_COLORS[i % TRACK_COLORS.length]}"></i><span></span><b class="ov-led"></b>`;
      row.querySelector('span')!.textContent = t.name || `Track ${i + 1}`;
      row.title = 'Click to view this track · ⌘/ctrl-click to add it';
      row.onclick = (e) => this.cb.selectTrack(i, e.metaKey || e.ctrlKey);
      this.names.append(row);
    });
    this.host.style.setProperty('--ov-rows', String(score.tracks.length));
    this.setLoop(null);
    this.setPlayhead(0);
    this.draw();
  }

  setTempoChanges(list: { bar: number; bpm: number }[]) {
    this.tempos = list;
    this.draw();
  }

  setNotes(bars: number[]) {
    this.noteBars = bars;
    this.draw();
  }

  setSections(sections: Section[]) {
    this.sections = sections;
    this.draw();
  }

  setTrackState(visible: number[], muted: number[]) {
    this.visible = new Set(visible);
    this.muted = new Set(muted);
    for (const row of this.names.querySelectorAll<HTMLElement>('.ov-name')) {
      const i = Number(row.dataset.index);
      row.classList.toggle('visible', this.visible.has(i));
      row.classList.toggle('muted', this.muted.has(i));
    }
    this.draw();
  }

  setActivity(active: Set<number>) {
    for (const row of this.names.querySelectorAll<HTMLElement>('.ov-name')) row.classList.toggle('active', active.has(Number(row.dataset.index)));
  }

  /** @param pos fractional bar index (e.g. 40.5 = halfway through bar 41) */
  setPlayhead(pos: number) {
    if (!this.bars) return;
    this.playhead.style.left = `${(pos / this.bars) * 100}%`;
  }

  setLoop(range: { start: number; end: number } | null) {
    this.place(this.loopEl, range);
  }

  private place(el: HTMLElement, range: { start: number; end: number } | null) {
    if (!range || !this.bars) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${(range.start / this.bars) * 100}%`;
    el.style.width = `${((range.end - range.start + 1) / this.bars) * 100}%`;
  }

  private barAt(clientX: number) {
    const r = this.canvasWrap.getBoundingClientRect();
    return Math.max(0, Math.min(this.bars - 1, Math.floor(((clientX - r.left) / r.width) * this.bars)));
  }

  private bindPointer() {
    const wrap = this.canvasWrap;
    wrap.addEventListener('pointerdown', (e) => {
      if (!this.bars) return;
      wrap.setPointerCapture(e.pointerId);
      this.dragStart = this.barAt(e.clientX);
      this.place(this.dragEl, { start: this.dragStart, end: this.dragStart });
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!this.bars) return;
      const bar = this.barAt(e.clientX);
      this.place(this.hoverEl, { start: bar, end: bar });
      const r = wrap.getBoundingClientRect();
      this.tip.textContent = this.cb.describeBar(bar);
      this.tip.style.display = 'block';
      const x = e.clientX - r.left;
      this.tip.style.left = `${Math.max(60, Math.min(r.width - 60, x))}px`;
      if (this.dragStart >= 0) {
        this.place(this.dragEl, { start: Math.min(this.dragStart, bar), end: Math.max(this.dragStart, bar) });
        if (bar !== this.dragStart) this.tip.textContent = `Loop bars ${Math.min(this.dragStart, bar) + 1}–${Math.max(this.dragStart, bar) + 1}`;
      }
    });
    wrap.addEventListener('pointerleave', () => {
      this.hoverEl.style.display = 'none';
      this.tip.style.display = 'none';
    });
    wrap.addEventListener('pointerup', (e) => {
      if (this.dragStart < 0) return;
      const end = this.barAt(e.clientX);
      const start = this.dragStart;
      this.dragStart = -1;
      this.dragEl.style.display = 'none';
      if (start === end) this.cb.seekBar(start);
      else this.cb.loopBars(Math.min(start, end), Math.max(start, end));
    });
  }

  draw() {
    const w = this.canvasWrap.clientWidth;
    const rows = this.density.length;
    const h = HEAD_H + rows * ROW_H;
    if (!w || !rows) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.height = `${h}px`;
    const g = this.canvas.getContext('2d')!;
    // Colours follow the interface theme (CSS custom properties).
    const css = getComputedStyle(this.host);
    const v = (name: string) => css.getPropertyValue(name).trim();
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const bw = w / this.bars;

    // Header: bar numbers (spaced so they never collide) and section markers.
    g.font = '500 9px Inter, sans-serif';
    g.textBaseline = 'middle';
    const every = [1, 2, 4, 5, 10, 20, 25, 50, 100].find((n) => n * bw >= 28) ?? 100;
    // Section labels take priority; bar numbers that would sit under one are skipped.
    g.font = '600 9.5px Inter, sans-serif';
    const labelSpans = this.sections.map((s) => [s.startBar * bw, s.startBar * bw + g.measureText(s.name).width + 10]);
    g.font = '500 9px Inter, sans-serif';
    g.fillStyle = v('--dim');
    for (let i = 0; i < this.bars; i += every) {
      if (i === 0 && every > 1) continue;
      const x = i * bw;
      const w = g.measureText(String(i + 1)).width + 2;
      if (labelSpans.some(([a, b]) => x + w > a && x < b)) continue;
      g.fillText(String(i + 1), x + 2, HEAD_H / 2);
      g.fillRect(x, HEAD_H - 4, 1, 4);
    }
    g.font = '600 9.5px Inter, sans-serif';
    for (const s of this.sections) {
      const x = s.startBar * bw;
      g.fillStyle = v('--accent');
      g.fillRect(x, 0, 1.5, h);
      g.fillStyle = v('--text');
      g.fillText(s.name, x + 4, HEAD_H / 2);
    }

    // Tempo changes: small blue diamonds on the header line.
    g.fillStyle = v('--blue');
    for (const t of this.tempos) {
      const x = t.bar * bw + 1;
      g.beginPath();
      g.moveTo(x, HEAD_H - 7);
      g.lineTo(x + 3, HEAD_H - 4);
      g.lineTo(x, HEAD_H - 1);
      g.lineTo(x - 3, HEAD_H - 4);
      g.fill();
    }

    // Practice-note markers.
    g.fillStyle = '#f7d75a';
    for (const b of this.noteBars) {
      const x = (b + 0.5) * bw;
      g.beginPath();
      g.moveTo(x - 4, HEAD_H - 9);
      g.lineTo(x + 4, HEAD_H - 9);
      g.lineTo(x, HEAD_H - 2);
      g.fill();
    }

    // Track rows.
    this.density.forEach((bars, t) => {
      const y = HEAD_H + t * ROW_H;
      const max = Math.max(1, ...bars);
      const color = TRACK_COLORS[t % TRACK_COLORS.length];
      const dim = this.muted.has(t);
      g.fillStyle = t % 2 ? v('--row-b') : v('--row-a');
      g.fillRect(0, y, w, ROW_H);
      bars.forEach((n, i) => {
        if (!n) return;
        g.globalAlpha = (dim ? 0.25 : 1) * (0.35 + 0.65 * Math.sqrt(n / max));
        g.fillStyle = color;
        const gap = bw > 4 ? 1 : 0;
        g.fillRect(i * bw + gap / 2, y + 3, Math.max(1, bw - gap), ROW_H - 6);
      });
      g.globalAlpha = 1;
    });
  }
}

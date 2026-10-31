// Live fretboard: draws the strings/frets for a tuning, lights up the notes sounding now and
// previews the next ones.

export type FretNoteKind = 'normal' | 'harmonic' | 'dead' | 'ghost';

export interface FretNote {
  /** 0 = highest-pitched string (top line of the tab). */
  string: number;
  fret: number;
  kind: FretNoteKind;
  /** Note is a held/tied continuation rather than a fresh attack. */
  held: boolean;
  /** Pitch name, shown when labels are set to notes. */
  label: string;
}

export interface FretboardOptions {
  labels: 'notes' | 'frets';
  lefty: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export class Fretboard {
  private svg: SVGSVGElement;
  private notesLayer: SVGGElement;
  private labels: string[] = [];
  private capo = 0;
  private readonly frets = 24;
  private readonly width = 1200;
  private readonly nutX = 66;
  private readonly top = 14;
  private readonly rowGap = 17;
  private opts: FretboardOptions = { labels: 'notes', lefty: false };
  private lastKey = '';

  /**
   * Called when a string name (fret 0) or a spot on the board is clicked, with the string index
   * (0 = highest) and the fret counted from the nut, ignoring any capo. May return the note's name,
   * which briefly marks the spot.
   */
  onNoteClick: ((string: number, fret: number) => string | void) | null = null;
  private hitLayer: SVGGElement;

  constructor(host: HTMLElement) {
    this.svg = el('svg', { class: 'fb-svg' });
    this.notesLayer = el('g', {});
    this.hitLayer = el('g', {});
    host.appendChild(this.svg);
    this.setup(['E', 'B', 'G', 'D', 'A', 'E'], 0);
  }

  setOptions(opts: Partial<FretboardOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.setup(this.labels, this.capo);
  }

  private mirror(x: number) {
    return this.opts.lefty ? this.width - x : x;
  }

  private fretX(fret: number): number {
    // Equal-temperament spacing, normalised so `frets` fills the board.
    const scale = (this.width - this.nutX - 12) / (1 - Math.pow(2, -this.frets / 12));
    return this.mirror(this.nutX + scale * (1 - Math.pow(2, -fret / 12)));
  }

  private noteX(fret: number): number {
    if (fret === 0) return this.mirror(this.nutX - 16);
    return (this.fretX(fret - 1) + this.fretX(fret)) / 2;
  }

  private rowY(s: number) {
    return this.top + s * this.rowGap;
  }

  /** @param labels string names from highest to lowest pitch */
  setup(labels: string[], capo: number) {
    this.labels = labels;
    this.capo = capo;
    this.lastKey = '';
    const n = labels.length;
    const height = this.top * 2 + this.rowGap * (n - 1) + 14;
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${height}`);
    this.svg.replaceChildren();

    const boardTop = this.top - 7;
    const boardBottom = this.rowY(n - 1) + 7;
    const midY = (boardTop + boardBottom) / 2;
    const x0 = Math.min(this.fretX(0), this.fretX(this.frets));
    const x1 = Math.max(this.fretX(0), this.fretX(this.frets));

    const defs = el('defs', {});
    const grad = el('linearGradient', { id: 'fb-wood', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(el('stop', { offset: 0, 'stop-color': '#2d2219' }), el('stop', { offset: 1, 'stop-color': '#1c1510' }));
    const glow = el('radialGradient', { id: 'fb-glow' });
    glow.append(el('stop', { offset: 0, 'stop-color': '#f2a33a', 'stop-opacity': 0.55 }), el('stop', { offset: 1, 'stop-color': '#f2a33a', 'stop-opacity': 0 }));
    defs.append(grad, glow);
    this.svg.append(defs);

    this.svg.append(el('rect', { x: x0, y: boardTop, width: x1 - x0, height: boardBottom - boardTop, rx: 3, fill: 'url(#fb-wood)' }));

    for (const f of INLAYS) this.svg.append(el('circle', { cx: this.noteX(f), cy: midY, r: 4.5, fill: '#4c3f33' }));
    for (const f of DOUBLE_INLAYS) {
      const off = this.rowGap * Math.min(2, (n - 1) / 2) * 0.6;
      this.svg.append(el('circle', { cx: this.noteX(f), cy: midY - off, r: 4.5, fill: '#4c3f33' }));
      this.svg.append(el('circle', { cx: this.noteX(f), cy: midY + off, r: 4.5, fill: '#4c3f33' }));
    }

    for (let f = 1; f <= this.frets; f++) {
      const x = this.fretX(f);
      this.svg.append(el('line', { x1: x, y1: boardTop, x2: x, y2: boardBottom, stroke: '#8c8577', 'stroke-width': 1.6 }));
      if (INLAYS.includes(f) || DOUBLE_INLAYS.includes(f)) {
        const num = el('text', { x: this.noteX(f), y: boardBottom + 12, 'text-anchor': 'middle', class: 'fb-fretnum' });
        num.textContent = String(f);
        this.svg.append(num);
      }
    }
    this.svg.append(el('rect', { x: this.fretX(0) - 2.5, y: boardTop, width: 5, height: boardBottom - boardTop, fill: '#ddd5c4', rx: 1 }));

    if (capo > 0) {
      const cx = (this.fretX(capo) + this.fretX(capo - 1)) / 2 + (this.opts.lefty ? -1 : 1) * 4;
      this.svg.append(el('rect', { x: cx - 5, y: boardTop - 4, width: 10, height: boardBottom - boardTop + 8, rx: 4, class: 'fb-capo' }));
    }

    for (let s = 0; s < n; s++) {
      const y = this.rowY(s);
      const thickness = 0.8 + (s / Math.max(1, n - 1)) * 1.8;
      this.svg.append(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#c9c2b2', 'stroke-width': thickness, opacity: 0.85 }));
      const labelX = this.opts.lefty ? this.width - 14 : 14;
      const g = el('g', { class: 'fb-string-label' });
      g.append(el('rect', { x: labelX - 12, y: y - 7.5, width: 24, height: 15, rx: 4 }));
      const t = el('text', { x: labelX, y: y + 4, 'text-anchor': 'middle' });
      t.textContent = labels[s];
      g.append(t);
      const title = el('title', {});
      title.textContent = `Play open ${labels[s]} string (tuning reference)`;
      g.append(title);
      g.addEventListener('click', () => this.play(s, capo));
      this.svg.append(g);
    }

    this.notesLayer = el('g', {});
    this.svg.append(this.notesLayer);

    // Click any spot to hear it. Drawn over the notes (invisible) so it always gets the click.
    this.hitLayer = el('g', { class: 'fb-hits' });
    for (let s = 0; s < n; s++) {
      const y = this.rowY(s);
      for (let f = 0; f <= this.frets; f++) {
        const [a, b] = f === 0 ? [this.mirror(this.nutX - 30), this.mirror(this.nutX - 3)] : [this.fretX(f - 1), this.fretX(f)];
        const g = el('g', { class: 'fb-cell' });
        g.append(el('rect', { x: Math.min(a, b), y: y - this.rowGap / 2, width: Math.abs(b - a), height: this.rowGap }));
        g.append(el('circle', { cx: this.noteX(f), cy: y, r: 7 }));
        g.addEventListener('click', () => this.play(s, Math.max(f, capo)));
        this.hitLayer.append(g);
      }
    }
    this.svg.append(this.hitLayer);
  }

  private play(string: number, fret: number) {
    const name = this.onNoteClick?.(string, fret);
    if (!name) return;
    const x = this.noteX(fret);
    const y = this.rowY(string);
    const g = el('g', { class: 'fb-tap' });
    g.append(el('circle', { cx: x, cy: y, r: 8.5 }));
    g.append(this.label(x, y, this.opts.labels === 'frets' ? String(fret - this.capo) : name));
    g.addEventListener('animationend', () => g.remove());
    this.svg.insertBefore(g, this.hitLayer);
  }

  private label(x: number, y: number, s: string) {
    const t = el('text', { x, y: y + 3.3, 'text-anchor': 'middle', class: s.length > 1 ? 'fb-small' : '' });
    t.textContent = s;
    return t;
  }

  show(current: FretNote[], upcoming: FretNote[] = []) {
    const key = JSON.stringify([current, upcoming]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.notesLayer.replaceChildren();
    const n = this.labels.length;
    const place = (note: FretNote) => {
      if (note.string < 0 || note.string >= n) return null;
      const fret = note.fret + this.capo;
      if (fret > this.frets) return null;
      return { x: this.noteX(fret), y: this.rowY(note.string), fret };
    };
    const text = (note: FretNote, fret: number) => (this.opts.labels === 'frets' ? String(fret - this.capo) : note.label);

    // Upcoming notes first, so sounding notes draw on top when they share a spot.
    for (const note of upcoming) {
      const p = place(note);
      if (!p || note.kind === 'dead') continue;
      const g = el('g', { class: 'fb-next' });
      g.append(el('circle', { cx: p.x, cy: p.y, r: 8.5 }));
      g.append(this.label(p.x, p.y, text(note, p.fret)));
      this.notesLayer.append(g);
    }

    for (const note of current) {
      const p = place(note);
      if (!p) continue;
      const g = el('g', { class: `fb-note fb-${note.kind}${note.held ? ' fb-held' : ''}` });
      if (!note.held && note.kind !== 'dead') g.append(el('circle', { cx: p.x, cy: p.y, r: 18, fill: 'url(#fb-glow)' }));
      if (note.kind === 'harmonic') {
        g.append(el('rect', { x: p.x - 7.5, y: p.y - 7.5, width: 15, height: 15, rx: 2, transform: `rotate(45 ${p.x} ${p.y})`, class: 'fb-dot' }));
      } else {
        g.append(el('circle', { cx: p.x, cy: p.y, r: note.kind === 'dead' ? 8 : 8.5, class: 'fb-dot' }));
      }
      g.append(this.label(p.x, p.y, note.kind === 'dead' ? '×' : text(note, p.fret)));
      this.notesLayer.append(g);
    }
  }
}

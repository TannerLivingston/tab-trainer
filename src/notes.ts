// Practice notes pinned to bars ("watch the stretch", "alternate picking here"): pins drawn over
// the sheet, an inline editor, and a list in the sidebar.
import type * as alphaTab from '@coderline/alphatab';

export interface BarNote {
  id: string;
  bar: number;
  text: string;
}

export interface NotesCallbacks {
  changed(notes: BarNote[]): void;
  seekBar(bar: number): void;
  /** A note was deleted; `restore` puts it back (for an Undo action). */
  deleted?(note: BarNote, restore: () => void): void;
}

const ICON =
  '<svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v4h4M8 11h8M8 15h6" /></svg>';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class BarNotes {
  notes: BarNote[] = [];
  private editor: HTMLElement;
  private editing: BarNote | null = null;

  constructor(
    private api: alphaTab.AlphaTabApi,
    private layer: HTMLElement,
    private list: HTMLElement,
    private cb: NotesCallbacks,
  ) {
    this.editor = document.createElement('div');
    this.editor.className = 'note-editor';
    this.editor.innerHTML = `
      <div class="ne-head"><span class="ne-bar"></span><button class="icon-btn ne-close" title="Close">✕</button></div>
      <textarea rows="3" placeholder="e.g. watch the stretch, use alternate picking…"></textarea>
      <div class="ne-actions"><button class="link-btn ne-delete">Delete</button><button class="btn primary ne-save">Save</button></div>`;
    this.editor.addEventListener('click', (e) => e.stopPropagation());
    this.editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeEditor();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.save();
    });
    this.editor.querySelector<HTMLElement>('.ne-close')!.onclick = () => this.closeEditor();
    this.editor.querySelector<HTMLElement>('.ne-save')!.onclick = () => this.save();
    this.editor.querySelector<HTMLElement>('.ne-delete')!.onclick = () => {
      if (this.editing) this.remove(this.editing.id);
      this.closeEditor();
    };
    document.addEventListener('click', () => this.closeEditor());
  }

  set(notes: BarNote[]) {
    this.notes = notes.slice().sort((a, b) => a.bar - b.bar);
    this.closeEditor();
    this.render();
  }

  forBar(bar: number) {
    return this.notes.filter((n) => n.bar === bar);
  }

  /** Open the editor for a new note on `bar` (or the existing one there). */
  add(bar: number) {
    const existing = this.forBar(bar)[0];
    this.openEditor(existing ?? { id: '', bar, text: '' });
  }

  private remove(id: string) {
    const gone = this.notes.find((n) => n.id === id);
    this.notes = this.notes.filter((n) => n.id !== id);
    this.render();
    this.cb.changed(this.notes);
    if (gone)
      this.cb.deleted?.(gone, () => {
        this.notes.push(gone);
        this.notes.sort((a, b) => a.bar - b.bar);
        this.render();
        this.cb.changed(this.notes);
      });
  }

  private save() {
    const e = this.editing;
    if (!e) return;
    const text = this.editor.querySelector('textarea')!.value.trim();
    if (!text) {
      if (e.id) this.remove(e.id);
    } else if (e.id) {
      e.text = text;
    } else {
      this.notes.push({ id: Math.random().toString(36).slice(2, 9), bar: e.bar, text });
      this.notes.sort((a, b) => a.bar - b.bar);
    }
    this.closeEditor();
    this.render();
    this.cb.changed(this.notes);
  }

  private barBox(bar: number) {
    const lookup = this.api.boundsLookup;
    if (!lookup) return null;
    for (const sys of lookup.staffSystems) for (const mb of sys.bars) if (mb.index === bar) return mb.visualBounds;
    return null;
  }

  private openEditor(note: BarNote) {
    this.editing = note;
    const box = this.barBox(note.bar);
    this.editor.querySelector('.ne-bar')!.textContent = `Note on bar ${note.bar + 1}`;
    this.editor.querySelector<HTMLElement>('.ne-delete')!.style.visibility = note.id ? 'visible' : 'hidden';
    const ta = this.editor.querySelector('textarea')!;
    ta.value = note.text;
    this.layer.append(this.editor);
    const left = box ? Math.min(box.x + box.w - 250, this.layer.clientWidth - 270) : 20;
    this.editor.style.left = `${Math.max(8, left)}px`;
    this.editor.style.top = `${box ? box.y + 26 : 20}px`;
    this.editor.classList.add('open');
    requestAnimationFrame(() => ta.focus());
  }

  private closeEditor() {
    this.editing = null;
    this.editor.classList.remove('open');
  }

  /** Re-place pins after every render (bar positions change with zoom, layout, tracks). */
  render() {
    for (const pin of this.layer.querySelectorAll('.note-pin')) pin.remove();
    const bars = [...new Set(this.notes.map((n) => n.bar))];
    for (const bar of bars) {
      const box = this.barBox(bar);
      if (!box) continue;
      const notes = this.forBar(bar);
      const pin = document.createElement('button');
      pin.className = 'note-pin';
      pin.innerHTML = `${ICON}<span class="np-text">${esc(notes[0].text)}</span>`;
      pin.title = notes.map((n) => n.text).join('\n');
      pin.style.left = `${box.x + box.w - 30}px`;
      pin.style.top = `${box.y + 2}px`;
      pin.onclick = (e) => {
        e.stopPropagation();
        this.openEditor(notes[0]);
      };
      this.layer.append(pin);
    }
    this.renderList();
  }

  private renderList() {
    this.list.replaceChildren();
    if (!this.notes.length) {
      this.list.innerHTML = '<li class="empty-note">Press N to pin a note to the current bar.</li>';
      return;
    }
    for (const n of this.notes) {
      const li = document.createElement('li');
      li.className = 'bar-note';
      li.innerHTML = `<span class="bn-bar">${n.bar + 1}</span><span class="bn-text">${esc(n.text)}</span>`;
      li.title = 'Jump to this bar';
      li.onclick = () => this.cb.seekBar(n.bar);
      li.ondblclick = (e) => {
        e.stopPropagation();
        this.openEditor(n);
      };
      this.list.append(li);
    }
  }
}

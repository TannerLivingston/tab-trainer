// Small transient notifications ("Loop: bars 41–42", "Speed 70%").
let host: HTMLElement | null = null;
let current: { el: HTMLElement; key?: string; timer: number } | null = null;

export function toast(text: string, opts: { key?: string; action?: { label: string; run: () => void }; ms?: number } = {}) {
  host ??= Object.assign(document.createElement('div'), { className: 'toasts' });
  if (!host.isConnected) (document.getElementById('app') ?? document.body).append(host);
  // Repeated updates of the same kind (e.g. speed nudges) reuse one toast instead of stacking.
  if (current && opts.key && current.key === opts.key) {
    current.el.querySelector('.toast-text')!.textContent = text;
    clearTimeout(current.timer);
  } else {
    current?.el.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span class="toast-text"></span>';
    el.querySelector('.toast-text')!.textContent = text;
    if (opts.action) {
      const b = document.createElement('button');
      b.textContent = opts.action.label;
      b.onclick = () => {
        opts.action!.run();
        el.remove();
      };
      el.append(b);
    }
    host.append(el);
    current = { el, key: opts.key, timer: 0 };
  }
  const mine = current!;
  mine.timer = window.setTimeout(() => {
    mine.el.classList.add('out');
    setTimeout(() => mine.el.remove(), 250);
    if (current === mine) current = null;
  }, opts.ms ?? 1800);
}

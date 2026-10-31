// Accessibility glue applied across the whole UI, including elements created later:
// - icon-only buttons and sliders get an accessible name from their tooltip
// - toggles, segmented buttons and mute/solo announce their pressed state
// - modals behave as dialogs (focus moves in, Tab stays inside, focus returns on close)

const PRESSABLE = '.toggle, .segmented button, .ms, .swatches button';

function label(el: Element) {
  if (!(el instanceof HTMLElement)) return;
  const title = el.getAttribute('title');
  if (!title || el.hasAttribute('aria-label')) return;
  const hasText = (el.textContent ?? '').trim().length > 1;
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || !hasText) el.setAttribute('aria-label', title);
}

function pressed(el: Element) {
  if (!(el instanceof HTMLElement) || !el.matches(PRESSABLE)) return;
  el.setAttribute('aria-pressed', String(el.classList.contains('on') || el.classList.contains('active')));
}

function sweep(root: ParentNode) {
  root.querySelectorAll('button[title], input[title], select[title]').forEach(label);
  root.querySelectorAll(PRESSABLE).forEach(pressed);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
const returnFocus = new Map<HTMLElement, HTMLElement | null>();

function dialogChanged(modal: HTMLElement) {
  if (!modal.hidden) {
    returnFocus.set(modal, document.activeElement as HTMLElement | null);
    // Focus the first control after the close button so keyboard users land on content.
    const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (items[1] ?? items[0])?.focus({ preventScroll: true });
  } else if (returnFocus.has(modal)) {
    returnFocus.get(modal)?.focus?.({ preventScroll: true });
    returnFocus.delete(modal);
  }
}

export function installA11y() {
  sweep(document);
  const toasts = () => document.querySelector('.toasts');
  for (const modal of document.querySelectorAll<HTMLElement>('.modal')) {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = modal.querySelector('h2');
    if (heading) {
      heading.id ||= `${modal.id}-title`;
      modal.setAttribute('aria-labelledby', heading.id);
    }
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => n instanceof Element && (label(n), pressed(n), sweep(n)));
      else if (r.attributeName === 'class') pressed(r.target as Element);
      else if (r.attributeName === 'hidden' && (r.target as Element).classList.contains('modal')) dialogChanged(r.target as HTMLElement);
      else if (r.attributeName === 'title') label(r.target as Element);
    }
    const t = toasts();
    if (t && !t.hasAttribute('role')) {
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'title'] });

  // Keep Tab inside an open dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = [...document.querySelectorAll<HTMLElement>('.modal')].find((m) => !m.hidden);
    if (!modal) return;
    const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

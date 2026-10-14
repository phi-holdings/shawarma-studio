/**
 * Styled tooltips for every element with a `title`, in place of the browser's grey box.
 *
 * On hover (after a short delay; at once when moving between controls) or keyboard focus, the title
 * moves into `data-tip` so the native tooltip stays away, and a bubble shows above the element (below
 * when there is no room). A trailing shortcut in brackets, "Play (⌘⏎)", is drawn as key caps. Titles
 * that are an element's only name become its aria-label, so screen readers keep them.
 */
const DELAY = 450;
const WARM_MS = 300;   // moving to the next control within this time shows its tip at once
const GAP = 8;
const EDGE = 8;

export function installTooltips(doc: Document = document): () => void {
  const tip = doc.createElement('div');
  tip.className = 'tip';
  tip.id = 'app-tooltip';
  tip.setAttribute('role', 'tooltip');
  doc.body.appendChild(tip);

  let target: HTMLElement | null = null;
  let timer = 0;
  let hiddenAt = 0;

  const textOf = (el: HTMLElement) => {
    const t = el.getAttribute('title');
    if (t !== null) {
      el.removeAttribute('title');
      if (t) el.dataset.tip = t; else delete el.dataset.tip;
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.textContent ?? '').trim();
      if (t && !named) el.setAttribute('aria-label', t);
    }
    return el.dataset.tip ?? '';
  };

  const render = (text: string) => {
    tip.replaceChildren();
    const m = /^(.*?)\s*\(([⌘⇧⌥⌃]+[^\s()]{1,3})\)$/u.exec(text);
    tip.append(m ? m[1] : text);
    if (m) {
      const keys = doc.createElement('span');
      keys.className = 'tip-keys';
      for (const k of Array.from(m[2])) {
        const kbd = doc.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      }
      tip.append(keys);
    }
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    let below = r.top - GAP - t.height < EDGE;
    if (below && r.bottom + GAP + t.height > vh - EDGE) below = false;
    const top = below ? r.bottom + GAP : r.top - GAP - t.height;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - t.width / 2), vw - EDGE - t.width);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tip.dataset.side = below ? 'below' : 'above';
  };

  const show = (el: HTMLElement) => {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    // a title that only repeats the element's own text is for when that text is cut off
    if (text === (el.textContent ?? '').trim() && el.scrollWidth <= el.clientWidth) return;
    target = el;
    render(text);
    tip.classList.add('on');
    place(el);
    el.setAttribute('aria-describedby', tip.id);
  };

  const hide = () => {
    window.clearTimeout(timer);
    if (!target) return;
    if (target.getAttribute('aria-describedby') === tip.id) target.removeAttribute('aria-describedby');
    target = null;
    hiddenAt = performance.now();
    tip.classList.remove('on');
  };

  const owner = (n: EventTarget | null) =>
    n instanceof Element ? (n.closest('[title], [data-tip]') as HTMLElement | null) : null;

  const arm = (el: HTMLElement, now: boolean) => {
    window.clearTimeout(timer);
    textOf(el);   // strip the native title before the browser shows it
    if (now) show(el); else timer = window.setTimeout(() => show(el), DELAY);
  };

  const over = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = owner(e.target);
    if (el === target) return;
    const warm = target !== null || performance.now() - hiddenAt < WARM_MS;
    hide();
    if (el) arm(el, warm);
  };
  const out = (e: PointerEvent) => {
    const el = owner(e.target);
    if (el && !el.contains(e.relatedTarget as Node | null)) hide();
  };
  const focusIn = (e: FocusEvent) => {
    const el = owner(e.target);
    if (el && el === e.target && el.matches(':focus-visible')) { hide(); arm(el, false); }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

  doc.addEventListener('pointerover', over);
  doc.addEventListener('pointerout', out);
  doc.addEventListener('pointerdown', hide, true);
  doc.addEventListener('focusin', focusIn);
  doc.addEventListener('focusout', hide);
  doc.addEventListener('keydown', key, true);
  doc.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  return () => {
    hide();
    doc.removeEventListener('pointerover', over);
    doc.removeEventListener('pointerout', out);
    doc.removeEventListener('pointerdown', hide, true);
    doc.removeEventListener('focusin', focusIn);
    doc.removeEventListener('focusout', hide);
    doc.removeEventListener('keydown', key, true);
    doc.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    tip.remove();
  };
}

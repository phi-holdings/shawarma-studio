// Mounts the landing page's Hairline figures into their placeholders (`[data-figure="spit"]` and so on).
// Plain DOM, so the prerendered page (src/seo/client.ts) and the React page (Landing) share it. Loaded
// lazily by both: the kernel and figures are ~50 kB and only the figures section needs them.
import HL from './hairline/kernel.js';
import drumMachine from './hairline/drum-machine.js';
import type { HairlineFigure } from './hairline/figure';
import mixingDesk from './hairline/mixing-desk.js';
import spit from './hairline/spit.js';

export const FIGURES: Record<string, HairlineFigure> = { spit, 'drum-machine': drumMachine, 'mixing-desk': mixingDesk };

/** Mounts every figure placeholder under `root` once; returns a function that takes them down again. */
export function mountFigures(root: ParentNode = document): () => void {
  HL.inject(document);
  const destroy: (() => void)[] = [];
  for (const stage of Array.from(root.querySelectorAll<HTMLElement>('[data-figure]'))) {
    const fig = FIGURES[stage.dataset.figure ?? ''];
    if (!fig || stage.dataset.mounted) continue;
    stage.dataset.mounted = '1';
    stage.setAttribute('data-hairline', fig.name);
    stage.setAttribute('role', 'img');
    stage.setAttribute('aria-label', fig.means);
    stage.tabIndex = -1;
    const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
    // the read-out names what is under the pointer ("ch 4 · bass"), or "rest"
    const out = stage.closest('[data-figure-card]')?.querySelector<HTMLElement>('[data-figure-read]') ?? null;
    let text: string | null = null;
    const read = {
      get textContent() { return text; },
      set textContent(v: string | null) { text = v == null ? '' : String(v); if (out) out.textContent = text; },
    };
    const handle = fig.mount({ stage, svg, read }, fig.range[1]);
    if (text === null) read.textContent = 'rest';
    destroy.push(() => { handle.destroy(); svg.remove(); delete stage.dataset.mounted; });
  }
  return () => destroy.forEach((d) => d());
}

/**
 * The landing's showcase: mounts the figures and makes the Layers / Beat / Mix tabs work (click, and the
 * arrow keys, Home and End, as a tab list should). Returns a function that undoes both.
 */
export function mountShowcase(root: ParentNode = document): () => void {
  const undoFigures = mountFigures(root);
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-show-tab]'));
  const select = (i: number, focus = false) => {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
    });
    if (focus) tabs[i]?.focus();
  };
  const onClick = (e: Event) => select(tabs.indexOf(e.currentTarget as HTMLButtonElement));
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(e.currentTarget as HTMLButtonElement);
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to, true);
  };
  tabs.forEach((t) => { t.addEventListener('click', onClick); t.addEventListener('keydown', onKey); });
  return () => {
    tabs.forEach((t) => { t.removeEventListener('click', onClick); t.removeEventListener('keydown', onKey); });
    undoFigures();
  };
}

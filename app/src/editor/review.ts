// Review Claude's proposal inside the editor. The editor holds the proposed code, compared against the
// buffer as it was (`original`) by @codemirror/merge's unified merge view: deleted lines are drawn inline,
// each change has Accept / Reject, and a panel on top steps through the changes. You can keep typing and
// playing while reviewing: what you play is the proposal. When no change is left to decide the review
// ends and reports the resulting code (onFinish); Cancel puts the original back (onCancel).
import { Compartment, ChangeSet, Prec, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, keymap, showPanel, type Panel } from '@codemirror/view';
import { acceptChunk, diff, getChunks, goToNextChunk, goToPreviousChunk, rejectChunk, unifiedMergeView } from '@codemirror/merge';
import './review.css';

export interface ReviewResult {
  /** The editor's code after the review. */
  code: string;
  /** The buffer the review started from. */
  original: string;
  accepted: number;
  rejected: number;
  /** Changes on offer when the review started. */
  total: number;
}

export interface ReviewOptions {
  original: string;
  proposed: string;
  /** Shown in the review bar, e.g. Claude's summary. */
  title?: string;
  onFinish(r: ReviewResult): void;
  onCancel?(): void;
}

interface Session {
  opts: ReviewOptions;
  total: number;
  accepted: number;
  rejected: number;
  ending: boolean;
}

const slot = new Compartment();
const installed = new WeakSet<EditorView>();
const sessions = new WeakMap<EditorView, Session>();

export const isReviewing = (view: EditorView) => sessions.has(view);

const chunkCount = (view: EditorView) => getChunks(view.state)?.chunks.length ?? 0;

/** The smallest change set turning the editor's document into `code` (keeps the cursor and scroll in place). */
function changesTo(view: EditorView, code: string): ChangeSet {
  const doc = view.state.doc.toString();
  return ChangeSet.of(diff(doc, code).map((c) => ({ from: c.fromA, to: c.toA, insert: code.slice(c.fromB, c.toB) })), doc.length);
}

/** Replaces the document with `code` through a minimal edit instead of replacing everything. */
export function setCodeMinimal(view: EditorView, code: string): void {
  if (view.state.doc.toString() === code) return;
  view.dispatch({ changes: changesTo(view, code) });
}

function acceptAt(view: EditorView, pos?: number): boolean {
  const s = sessions.get(view);
  if (!s || !acceptChunk(view, pos)) return false;
  s.accepted++;
  return true;
}

function rejectAt(view: EditorView, pos?: number): boolean {
  const s = sessions.get(view);
  if (!s || !rejectChunk(view, pos)) return false;
  s.rejected++;
  return true;
}

/** Decide every remaining change the same way. */
export function decideAll(view: EditorView, accept: boolean): void {
  for (let guard = 0; guard < 10_000; guard++) {
    const chunks = getChunks(view.state)?.chunks;
    if (!chunks?.length) break;
    if (!(accept ? acceptAt(view, chunks[0].fromB) : rejectAt(view, chunks[0].fromB))) break;
  }
}

function end(view: EditorView, s: Session, cancelled: boolean) {
  if (s.ending) return;
  s.ending = true;
  // never dispatch from inside an update
  setTimeout(() => {
    const original = s.opts.original;
    const changes = cancelled ? changesTo(view, original) : undefined;
    sessions.delete(view);
    view.dispatch({ ...(changes ? { changes } : {}), effects: slot.reconfigure([]) });
    if (cancelled) s.opts.onCancel?.();
    else s.opts.onFinish({ code: view.state.doc.toString(), original, accepted: s.accepted, rejected: s.rejected, total: s.total });
  }, 0);
}

/** Ends a review without deciding the rest: the original code comes back. */
export function cancelReview(view: EditorView): void {
  const s = sessions.get(view);
  if (s) end(view, s, true);
}

/** Ends a review now, keeping the editor as it is (e.g. the project was switched away). */
export function dropReview(view: EditorView): void {
  if (!sessions.has(view)) return;
  sessions.delete(view);
  view.dispatch({ effects: slot.reconfigure([]) });
}

function button(text: string, label: string, cls: string, onClick: () => void, keys?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.title = keys ? `${label} (${keys})` : label;
  b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the editor's cursor
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
const k = (s: string) => (mac ? s.replace(/Mod-/g, '⌘').replace(/Alt-/g, '⌥').replace(/Shift-/g, '⇧') : s.replace(/Mod-/g, 'Ctrl+').replace(/Alt-/g, 'Alt+').replace(/Shift-/g, 'Shift+'));

const KEYS = {
  accept: 'Mod-Alt-y', reject: 'Mod-Alt-n', acceptAll: 'Mod-Shift-Enter', rejectAll: 'Mod-Shift-Backspace',
  next: 'Mod-Alt-ArrowDown', prev: 'Mod-Alt-ArrowUp',
};

function reviewPanel(view: EditorView): Panel {
  const s = sessions.get(view)!;
  const dom = document.createElement('div');
  dom.className = 'cm-review-panel';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', 'Review Shawarma\'s change');
  const title = document.createElement('span');
  title.className = 'cm-review-title';
  title.textContent = s.opts.title ? `Shawarma: ${s.opts.title}` : 'Shawarma\'s change';
  title.title = title.textContent;
  const count = document.createElement('span');
  count.className = 'cm-review-count';
  count.setAttribute('role', 'status');
  const go = (cmd: typeof goToNextChunk) => { cmd(view); view.focus(); };
  dom.append(
    title, count,
    button('↑', 'Previous change', 'btn-ghost btn-icon', () => go(goToPreviousChunk), k(KEYS.prev)),
    button('↓', 'Next change', 'btn-ghost btn-icon', () => go(goToNextChunk), k(KEYS.next)),
    button('Cancel', 'Cancel review', 'btn-ghost', () => cancelReview(view)),
    button('Reject all', 'Reject all', 'btn-ghost', () => decideAll(view, false), k(KEYS.rejectAll)),
    button('Accept all', 'Accept all', 'btn-primary', () => decideAll(view, true), k(KEYS.acceptAll)),
  );
  const refresh = () => {
    const n = chunkCount(view);
    count.textContent = `${n} ${n === 1 ? 'change' : 'changes'} left`;
  };
  refresh();
  return { dom, top: true, update: refresh };
}

/** Accept / Reject on each change, with their keyboard shortcuts in the tooltip. */
function controls(view: () => EditorView) {
  return (type: 'accept' | 'reject', action: (e: MouseEvent) => void): HTMLElement => {
    const accept = type === 'accept';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cm-review-chunk-btn ${accept ? 'accept' : 'reject'}`;
    b.textContent = accept ? 'Accept' : 'Reject';
    b.setAttribute('aria-label', accept ? 'Accept this change' : 'Reject this change');
    b.title = `${accept ? 'Accept' : 'Reject'} this change (${k(accept ? KEYS.accept : KEYS.reject)} at the cursor)`;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      const s = sessions.get(view());
      if (s) { if (accept) s.accepted++; else s.rejected++; }
      action(e);
    });
    return b;
  };
}

function extension(view: EditorView, original: string): Extension {
  const cmd = (f: (v: EditorView) => boolean) => (v: EditorView) => (isReviewing(v) ? f(v) : false);
  return [
    unifiedMergeView({ original, mergeControls: controls(() => view), highlightChanges: true, gutter: true, allowInlineDiffs: true }),
    showPanel.of(reviewPanel),
    Prec.highest(keymap.of([
      { key: KEYS.accept, run: cmd((v) => acceptAt(v)) },
      { key: KEYS.reject, run: cmd((v) => rejectAt(v)) },
      { key: KEYS.acceptAll, run: cmd((v) => { decideAll(v, true); return true; }) },
      { key: KEYS.rejectAll, run: cmd((v) => { decideAll(v, false); return true; }) },
      { key: KEYS.next, run: cmd(goToNextChunk) },
      { key: KEYS.prev, run: cmd(goToPreviousChunk) },
      { key: 'F7', run: cmd(goToNextChunk) },
      { key: 'Shift-F7', run: cmd(goToPreviousChunk) },
    ])),
    // the review is over once every change is decided
    EditorView.updateListener.of((u) => {
      const s = sessions.get(u.view);
      if (s && !s.ending && chunkCount(u.view) === 0) end(u.view, s, false);
    }),
  ];
}

/**
 * Starts reviewing `proposed` against `original` (the editor must hold `original`). Returns false when
 * there is nothing to review or a review is already running.
 */
export function startReview(view: EditorView, opts: ReviewOptions): boolean {
  if (sessions.has(view) || opts.proposed === opts.original) return false;
  if (!installed.has(view)) {
    installed.add(view);
    view.dispatch({ effects: StateEffect.appendConfig.of(slot.of([])) });
  }
  if (view.state.doc.toString() !== opts.original) setCodeMinimal(view, opts.original);
  const s: Session = { opts, total: 0, accepted: 0, rejected: 0, ending: false };
  sessions.set(view, s);
  // the proposal and the merge view arrive in one transaction, so the change list starts out complete
  const changes = changesTo(view, opts.proposed);
  view.dispatch({ changes, effects: slot.reconfigure(extension(view, opts.original)), scrollIntoView: false });
  s.total = chunkCount(view);
  const first = getChunks(view.state)?.chunks[0];
  if (first) view.dispatch({ selection: { anchor: first.fromB }, effects: EditorView.scrollIntoView(first.fromB, { y: 'center' }) });
  return true;
}

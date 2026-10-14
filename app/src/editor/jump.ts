// Jump to a place in the code (from the console, the sections menu): cursor there, line centred and
// briefly marked so the eye finds it.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

const markLine = StateEffect.define<number | null>();

export const jumpMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let v = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(markLine)) continue;
      v = e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-jump-line' }).range(e.value)]);
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Puts the cursor at `pos` (clamped), centres its line and marks it for a moment. */
export function jumpTo(view: EditorView, pos: number) {
  const at = Math.max(0, Math.min(pos, view.state.doc.length));
  const line = view.state.doc.lineAt(at);
  view.dispatch({
    selection: { anchor: at },
    effects: [EditorView.scrollIntoView(at, { y: 'center' }), markLine.of(line.from)],
  });
  view.focus();
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { if (view.dom.isConnected) view.dispatch({ effects: markLine.of(null) }); }, 1400);
}

/** Position of a 1-based line and column, clamped to the document. */
export function linePos(view: EditorView, line: number, col = 1): number {
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  return Math.min(l.to, l.from + Math.max(0, col - 1));
}

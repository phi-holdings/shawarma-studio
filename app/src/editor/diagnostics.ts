// Inline error markers (spec §7): evaluation errors from the runtime and located inspect issues are
// shown on the offending line, with the message under it, as on strudel.cc.
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export type DiagnosticSource = 'eval' | 'inspect';
export interface LineDiagnostic { line: number; col?: number; message: string; severity: 'error' | 'warning' }

export const setDiagnostics = StateEffect.define<{ source: DiagnosticSource; items: LineDiagnostic[] }>();

class MessageWidget extends WidgetType {
  constructor(readonly text: string, readonly severity: LineDiagnostic['severity']) { super(); }
  eq(o: MessageWidget) { return o.text === this.text && o.severity === this.severity; }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-diagnostic-msg cm-diagnostic-${this.severity}`;
    el.setAttribute('role', 'alert');
    el.textContent = this.text;
    return el;
  }
}

/** Positioned diagnostics per source; positions are mapped through edits until replaced. */
interface Placed { pos: number; col?: number; message: string; severity: LineDiagnostic['severity'] }
type Stored = Record<DiagnosticSource, Placed[]>;

const place = (state: EditorState, items: LineDiagnostic[]): Placed[] =>
  items
    .filter((d) => d.line >= 1 && d.line <= state.doc.lines)
    .map((d) => ({ pos: state.doc.line(d.line).from, col: d.col, message: d.message, severity: d.severity }));

const field = StateField.define<Stored>({
  create: () => ({ eval: [], inspect: [] }),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      const map = (xs: Placed[]) => xs.map((d) => ({ ...d, pos: tr.changes.mapPos(d.pos) }));
      next = { eval: map(next.eval), inspect: map(next.inspect) };
    }
    for (const e of tr.effects) if (e.is(setDiagnostics)) next = { ...next, [e.value.source]: place(tr.state, e.value.items) };
    return next;
  },
  provide: (f) => EditorView.decorations.from(f, (value): DecorationSet => {
    const byLine = new Map<number, Placed[]>();
    for (const d of [...value.eval, ...value.inspect]) byLine.set(d.pos, [...(byLine.get(d.pos) ?? []), d]);
    const builder = new RangeSetBuilder<Decoration>();
    for (const pos of [...byLine.keys()].sort((a, b) => a - b)) {
      const ds = byLine.get(pos)!;
      const severity = ds.some((d) => d.severity === 'error') ? 'error' : 'warning';
      const text = [...new Set(ds.map((d) => d.message))].join('\n');
      builder.add(pos, pos, Decoration.line({ class: `cm-diagnostic-line cm-diagnostic-line-${severity}`, attributes: { title: text } }));
    }
    return builder.finish();
  }),
});

/** Message rows under the affected lines (block widgets need a StateField-provided decoration set). */
const messages = EditorView.decorations.compute([field], (state) => {
  const value = state.field(field);
  const byLine = new Map<number, Placed[]>();
  for (const d of [...value.eval, ...value.inspect]) byLine.set(d.pos, [...(byLine.get(d.pos) ?? []), d]);
  const builder = new RangeSetBuilder<Decoration>();
  for (const pos of [...byLine.keys()].sort((a, b) => a - b)) {
    const ds = byLine.get(pos)!;
    const end = state.doc.lineAt(Math.min(pos, state.doc.length)).to;
    const severity = ds.some((d) => d.severity === 'error') ? 'error' : 'warning';
    const text = [...new Set(ds.map((d) => d.message))].join('\n');
    builder.add(end, end, Decoration.widget({ widget: new MessageWidget(text, severity), block: true, side: 1 }));
  }
  return builder.finish();
});

const theme = EditorView.baseTheme({
  '.cm-diagnostic-line-error': { backgroundColor: 'color-mix(in srgb, var(--err) 14%, transparent)', boxShadow: 'inset 3px 0 0 var(--err)' },
  '.cm-diagnostic-line-warning': { backgroundColor: 'color-mix(in srgb, var(--warn) 12%, transparent)', boxShadow: 'inset 3px 0 0 var(--warn)' },
  '.cm-diagnostic-msg': { font: '12px ui-monospace, Menlo, monospace', padding: '1px 8px 2px 12px', whiteSpace: 'pre-wrap' },
  '.cm-diagnostic-error': { color: 'var(--err)', backgroundColor: 'color-mix(in srgb, var(--err) 10%, transparent)' },
  '.cm-diagnostic-warning': { color: 'var(--warn)', backgroundColor: 'color-mix(in srgb, var(--warn) 8%, transparent)' },
});

export const diagnostics: Extension = [field, messages, theme];

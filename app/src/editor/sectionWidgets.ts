// Play controls inside the editor: a "play song" widget on the arrange( line (line 1 without arrange())
// and, per section, play-from / loop / start time on its arrange() entry line and its header comment line.
// Decorations only: the document text is never changed. Positions map through edits until the next
// section map (debounced inspect) re-derives them.
import { MapMode, StateEffect, StateField, type EditorState, type Extension, type Range as CmRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { arrangeLayout, type Section, type SongMap } from '@shawarma/shared';

export type PlayMode =
  | { kind: 'song' }
  | { kind: 'from'; startCycle: number }
  | { kind: 'loop'; startCycle: number; cycles: number }
  | { kind: 'other' };                           // e.g. a selection: no song position

export interface SectionActions {
  playSong(): void;
  playFrom(s: Section): void;
  loop(s: Section): void;
  stop(): void;
}

/** One widget anchor: the position maps through edits; the widget renders at the end of its line. */
interface Mark { pos: number; section: Section | null; where: 'entry' | 'header' | 'def' | 'song' }

export interface PlayStatus { playing: boolean; mode: PlayMode; active: number | null }

interface WidgetState { marks: Mark[]; map: SongMap | null; status: PlayStatus }

export const setSectionMarks = StateEffect.define<{ marks: Mark[]; map: SongMap | null }>();
export const setPlayStatus = StateEffect.define<PlayStatus>();

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Song position (cycle within the arrangement) that scheduler time `t` plays in `mode`. */
export function songCycle(mode: PlayMode, t: number, total: number): number | null {
  if (!(total > 0)) return null;
  const at = mode.kind === 'song' ? t
    : mode.kind === 'from' ? mode.startCycle + t
    : mode.kind === 'loop' ? mode.startCycle + (((t % mode.cycles) + mode.cycles) % mode.cycles)
    : null;
  return at === null ? null : ((at % total) + total) % total;
}

export function activeSection(map: SongMap | null, mode: PlayMode, t: number): number | null {
  if (!map) return null;
  const at = songCycle(mode, t, map.totalCycles);
  if (at === null) return null;
  return map.sections.find((s) => at >= s.startCycle && at < s.startCycle + s.cycles)?.index ?? null;
}

/** Widget anchors for `code`: song widget + one per section entry and matched header. */
export function deriveMarks(code: string, map: SongMap | null): Mark[] {
  const layout = arrangeLayout(code);
  const marks: Mark[] = [{ pos: layout?.call ?? 0, section: null, where: 'song' }];
  // also on line 1 when arrange() sits further down, so the whole song can be played from the top
  if (layout && code.slice(0, layout.call).includes('\n')) marks.unshift({ pos: 0, section: null, where: 'song' });
  if (!layout || !map || map.sections.length !== layout.entries.length) return marks;
  map.sections.forEach((s, i) => {
    marks.push({ pos: layout.entries[i].from, section: s, where: 'entry' });
    const h = layout.headers[i];
    if (h !== null) marks.push({ pos: h, section: s, where: 'header' });
    const d = layout.defs[i];
    // the definition line, unless it is the same line as the header widget
    if (d !== null && (h === null || code.slice(h, d).includes('\n'))) marks.push({ pos: d, section: s, where: 'def' });
  });
  return marks;
}

function button(text: string, label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `cm-sw-btn ${cls}`;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection and focus
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

class SongWidget extends WidgetType {
  constructor(readonly playing: boolean, readonly duration: string | null, readonly actions: () => SectionActions) { super(); }
  eq(o: SongWidget) { return o.playing === this.playing && o.duration === this.duration; }
  toDOM() {
    const w = document.createElement('span');
    w.className = `cm-section-widget cm-song-widget${this.playing ? ' cm-sw-playing' : ''}`;
    w.append(this.playing
      ? button('■', 'Stop song', 'cm-sw-stop', () => this.actions().stop())
      : button('▶', 'Play song', 'cm-sw-play', () => this.actions().playSong()));
    if (this.duration) {
      const t = document.createElement('span');
      t.className = 'cm-sw-time';
      t.textContent = this.duration;
      w.append(t);
    }
    return w;
  }
  ignoreEvent() { return true; }
}

class SectionWidget extends WidgetType {
  constructor(readonly section: Section, readonly where: 'entry' | 'header' | 'def', readonly active: boolean, readonly looping: boolean,
    readonly actions: () => SectionActions) { super(); }
  eq(o: SectionWidget) {
    const a = o.section, b = this.section;
    return o.where === this.where && o.active === this.active && o.looping === this.looping
      && a.index === b.index && a.label === b.label && a.startCycle === b.startCycle && a.cycles === b.cycles && a.startSec === b.startSec;
  }
  toDOM() {
    const s = this.section;
    const w = document.createElement('span');
    w.className = `cm-section-widget cm-sw-${this.where}${this.active ? ' cm-sw-active' : ''}`;
    w.dataset.section = String(s.index);
    w.append(
      this.active
        ? button('■', `Stop ${s.label}`, 'cm-sw-stop', () => this.actions().stop())
        : button('▶', `Play from ${s.label}`, 'cm-sw-play', () => this.actions().playFrom(s)),
      button('⟳', `Loop ${s.label}`, `cm-sw-loop${this.looping ? ' cm-sw-on' : ''}`, () => this.actions().loop(s)),
    );
    const loopBtn = w.lastElementChild as HTMLElement;
    loopBtn.setAttribute('aria-pressed', String(this.looping));
    const t = document.createElement('span');
    t.className = 'cm-sw-time';
    t.textContent = fmtTime(s.startSec);
    w.append(t);
    return w;
  }
  ignoreEvent() { return true; }
}

function build(state: EditorState, ws: WidgetState, actions: () => SectionActions): DecorationSet {
  const { status, map } = ws;
  const decos: CmRange<Decoration>[] = [];
  for (const m of ws.marks) {
    const pos = Math.min(m.pos, state.doc.length);
    const end = state.doc.lineAt(pos).to;
    let widget: WidgetType;
    if (!m.section) widget = new SongWidget(status.playing, map ? fmtTime(map.durationSec) : null, actions);
    else {
      const s = m.section;
      const looping = status.playing && status.mode.kind === 'loop' && status.mode.startCycle === s.startCycle && status.mode.cycles === s.cycles;
      widget = new SectionWidget(s, m.where as 'entry' | 'header' | 'def', status.playing && status.active === s.index, looping, actions);
    }
    decos.push(Decoration.widget({ widget, side: 1 }).range(end));
  }
  return Decoration.set(decos, true);
}

const theme = EditorView.baseTheme({
  '.cm-section-widget': {
    display: 'inline-flex', alignItems: 'center', gap: '1px', marginLeft: '1.25em', padding: '1px 8px 1px 2px',
    borderRadius: '999px', verticalAlign: 'middle', fontFamily: 'var(--ui)', fontSize: '12px', lineHeight: '18px',
    color: 'var(--text-dim)', background: 'var(--raised)', boxShadow: 'inset 0 0 0 1px var(--line)',
    opacity: '0.85', transition: 'opacity 100ms',
  },
  '.cm-line:hover .cm-section-widget, .cm-section-widget:focus-within': { opacity: '1' },
  '.cm-section-widget.cm-sw-active, .cm-section-widget.cm-sw-playing': { opacity: '1', color: 'var(--live-ink)', background: 'var(--live)', boxShadow: 'none' },
  '.cm-sw-btn': {
    font: 'inherit', fontSize: '11px', color: 'inherit', background: 'transparent', border: '0', borderRadius: '999px',
    width: '18px', height: '18px', padding: '0', cursor: 'pointer', display: 'inline-grid', placeItems: 'center',
  },
  '.cm-sw-btn:hover': { background: 'var(--hover)', color: 'var(--text)' },
  '.cm-sw-active .cm-sw-btn:hover, .cm-sw-playing .cm-sw-btn:hover': { background: 'rgba(0,0,0,0.15)', color: 'inherit' },
  '.cm-sw-btn:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-sw-loop.cm-sw-on': { color: 'var(--accent)' },
  '.cm-sw-time': { fontVariantNumeric: 'tabular-nums', paddingLeft: '4px' },
});

/** The section widgets extension; `actions` is read when a widget is clicked (so it can change). */
export function sectionWidgets(actions: () => SectionActions): Extension {
  const field = StateField.define<{ ws: WidgetState; decos: DecorationSet }>({
    create(state) {
      const ws: WidgetState = { marks: [{ pos: 0, section: null, where: 'song' }], map: null, status: { playing: false, mode: { kind: 'other' }, active: null } };
      return { ws, decos: build(state, ws, actions) };
    },
    update(v, tr) {
      let ws = v.ws;
      let changed = false;
      if (tr.docChanged) {
        // a section whose anchor text was deleted loses its widget until the next map; the song widget stays
        ws = {
          ...ws,
          marks: ws.marks.flatMap((m) => {
            const pos = m.section ? tr.changes.mapPos(m.pos, -1, MapMode.TrackDel) : tr.changes.mapPos(m.pos, -1);
            return pos === null ? [] : [{ ...m, pos }];
          }),
        };
        changed = true;
      }
      for (const e of tr.effects) {
        if (e.is(setSectionMarks)) { ws = { ...ws, marks: e.value.marks, map: e.value.map }; changed = true; }
        if (e.is(setPlayStatus)) { ws = { ...ws, status: e.value }; changed = true; }
      }
      return changed ? { ws, decos: build(tr.state, ws, actions) } : v;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });
  return [field, theme];
}

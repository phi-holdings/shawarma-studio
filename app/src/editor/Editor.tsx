import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StateEffect } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { flash, highlightMiniLocations, initEditor, sliderValues, updateMiniLocations, updateSliderWidgets } from '@strudel/codemirror';
import { lastExpression, type InspectReport, type Issue, type Range, type Section, type SongMap } from '@shawarma/shared';
import { getRuntime } from '../runtime/client';
import { errorLocation, RuntimeError } from '../runtime/errors';
import type { Evaluated, PatternRef } from '../runtime/protocol';
import { fakeHap } from './highlight';
import { buildPosMap, mapRange, type CopyOrigin, type PosMap } from '../runtime/remap';
import { diagnostics, setDiagnostics, type LineDiagnostic } from './diagnostics';
import { activeSection, deriveMarks, sectionWidgets, setPlayStatus, setSectionMarks, type PlayMode, type SectionActions } from './sectionWidgets';
import { useEditorPrefs, type EditorPrefs } from './prefs';
import { prefsEffects, searchExtension } from './prefsExtension';
import { jumpMarks, jumpTo, linePos } from './jump';
import './editor.css';

export interface EditorHandle {
  getCode(): string;
  setCode(code: string): void;
  /** Inserts text at the cursor (replacing the selection) and focuses the editor. */
  insertText(text: string): void;
  getSelection(): Range;
  /** Plays the buffer, or a derived program (`origin`: the document range its appended copy came from). */
  play(code?: string, origin?: CopyOrigin): Promise<void>;
  playFrom(startCycle: number): Promise<void>;
  loop(startCycle: number, cycles: number): Promise<void>;
  stop(): void;
  /** Compiles in the song runtime without sound; the pattern stays there, referenced by its code. */
  evaluatePattern(code: string): Promise<{ pattern: PatternRef; cps: number }>;
  isPlaying(): boolean;
  /** The CodeMirror view, for reviewing a proposal in place (editor/review.ts). */
  getView(): EditorView | null;
  /** Cursor to a 1-based line (and column), centred and briefly marked. */
  goToLine(line: number, col?: number): void;
  /** Cursor to a document position, centred and briefly marked. */
  jumpTo(pos: number): void;
  /** One undoable edit; the cursor goes to the end of the inserted text (and the editor takes focus unless `focus: false`). */
  edit(change: { from: number; to: number; insert: string }, opts?: { focus?: boolean }): void;
}

interface Props {
  initialCode: string;
  onChange(code: string): void;
  onPlayingChange?(p: boolean): void;
  /** Inspect issues; those with a location in their message are marked in the editor. */
  issues?: Issue[];
  /** The latest inspect report and the code it describes: its section map drives the play widgets. */
  inspected?: { report: InspectReport; code: string } | null;
  /** A play/loop started from a widget or shortcut failed. */
  onError?(e: unknown): void;
  /** Whether some code is selected (drives "Run selection" vs "Run all"). */
  onSelectionChange?(hasSelection: boolean): void;
}

/**
 * Where an inserted snippet goes: a method chain (".bank(...)") or a replaced selection goes at the
 * cursor; a whole expression (s("bd")) gets its own line instead of being glued into the current one.
 */
export function smartInsert(doc: string, from: number, to: number, text: string): { from: number; to: number; insert: string } {
  if (to > from || text.startsWith('.')) return { from, to, insert: text };
  const lineStart = doc.lastIndexOf('\n', from - 1) + 1;
  let lineEnd = doc.indexOf('\n', from);
  if (lineEnd < 0) lineEnd = doc.length;
  if (doc.slice(lineStart, lineEnd).trim() === '') return { from, to, insert: text };
  return { from: lineEnd, to: lineEnd, insert: `\n${text}` };
}

const isMod = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

const toLineDiagnostic = (message: string, line?: number, col?: number): LineDiagnostic[] =>
  line ? [{ line, col, message, severity: 'error' }] : [];

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initialCode, onChange, onPlayingChange, issues, inspected, onError, onSelectionChange }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const playing = useRef(false);
  const posMap = useRef<PosMap>(() => null);
  const sliderIds = useRef(new Map<string, string[]>()); // document slider id -> runtime slider ids
  const callbacks = useRef({ onChange, onPlayingChange, onError, onSelectionChange });
  callbacks.current = { onChange, onPlayingChange, onError, onSelectionChange };
  // what the runtime plays (for the active section) and the map the widgets show
  const mode = useRef<PlayMode>({ kind: 'other' });
  const songMap = useRef<SongMap | null>(null);
  const active = useRef<number | null>(null);
  const pushStatus = () => view.current?.dispatch({ effects: setPlayStatus.of({ playing: playing.current, mode: mode.current, active: active.current }) });
  const attempt = (p: Promise<unknown>) => { p.catch((e) => callbacks.current.onError?.(e)); };
  /** Cmd/Ctrl+Enter: re-evaluate; a section being played from / looped keeps its place. */
  const update = () => {
    const m = mode.current;
    if (playing.current && m.kind === 'from') return handle.playFrom(m.startCycle);
    if (playing.current && m.kind === 'loop') return handle.loop(m.startCycle, m.cycles);
    return handle.play();
  };
  const actions: SectionActions = {
    playSong: () => attempt(handle.play()),
    playFrom: (s: Section) => attempt(handle.playFrom(s.startCycle)),
    loop: (s: Section) => attempt(handle.loop(s.startCycle, s.cycles)),
    stop: () => handle.stop(),
  };
  const runtime = getRuntime();
  const prefs = useEditorPrefs();
  const appliedPrefs = useRef<EditorPrefs | null>(null);
  const lastLocs = useRef<[number, number][]>([]);   // restored when pattern highlighting is switched back on

  const setEvalError = (e: unknown) => {
    const v = view.current;
    if (!v) return;
    const items = e instanceof RuntimeError && e.line && e.line <= v.state.doc.lines ? toLineDiagnostic(e.message, e.line, e.col) : [];
    v.dispatch({ effects: setDiagnostics.of({ source: 'eval', items }) });
  };

  /** After a successful evaluate: mini-notation marks, sliders, and the position map for highlights. */
  const applyEvaluated = (ev: Evaluated, origin?: CopyOrigin) => {
    const v = view.current!;
    const doc = v.state.doc.toString();
    const map = buildPosMap(ev.code, doc, origin);
    posMap.current = map;
    const seen = new Set<string>();
    const locs = ev.miniLocations.map(([a, b]) => mapRange(map, a, b)).filter((r): r is [number, number] => {
      if (!r || seen.has(r.join(':'))) return false;
      seen.add(r.join(':'));
      return true;
    });
    updateMiniLocations(v, locs);
    lastLocs.current = locs;
    const ids = new Map<string, string[]>();
    const widgets: object[] = [];
    for (const s of ev.sliders) {
      const r = mapRange(map, s.from, s.to);
      if (!r || r[1] > doc.length) continue;
      const docId = `slider_${r[0]}`;
      ids.set(docId, [...(ids.get(docId) ?? []), `slider_${s.from}`]);
      if (ids.get(docId)!.length > 1) continue;
      sliderValues[docId] = Number(s.value); // keeps @strudel/codemirror's own listener quiet in this realm
      widgets.push({ ...s, from: r[0], to: r[1], type: 'slider' });
    }
    sliderIds.current = ids;
    updateSliderWidgets(v, widgets);
    v.dispatch({ effects: setDiagnostics.of({ source: 'eval', items: [] }) });
  };

  useEffect(() => {
    const v: EditorView = initEditor({
      root: root.current,
      initialCode,
      onChange: (u: ViewUpdate) => {
        if (u.selectionSet || u.docChanged) callbacks.current.onSelectionChange?.(!u.state.selection.main.empty);
        if (!u.docChanged) return;
        if (import.meta.env.DEV) (window as any).__editorChanges = ((window as any).__editorChanges ?? 0) + 1; // e2e: setCode fires once
        callbacks.current.onChange(u.state.doc.toString());
      },
      onEvaluate: () => attempt(update()),
      onStop: () => handle.stop(),
    });
    v.dispatch({ effects: StateEffect.appendConfig.of([diagnostics, sectionWidgets(() => actions), searchExtension, jumpMarks]) });
    v.dispatch({ effects: prefsEffects(prefs) });   // editor preferences (prefs.ts) over Strudel's own settings
    appliedPrefs.current = prefs;
    // the app's own look (app.css): its code face and size, its background
    root.current!.style.display = 'block';
    const cm = root.current!.querySelector<HTMLElement>('.cm-editor');
    if (cm) cm.style.backgroundColor = 'transparent';
    view.current = v;

    const offs = [
      runtime.on('started', () => { playing.current = true; callbacks.current.onPlayingChange?.(true); pushStatus(); }),
      runtime.on('stopped', () => {
        playing.current = false;
        active.current = null;
        callbacks.current.onPlayingChange?.(false);
        updateMiniLocations(v, []);
        pushStatus();
      }),
      runtime.on('activeHaps', (m) => {
        if (playing.current && m.time > 0) {
          const a = activeSection(songMap.current, mode.current, m.time);
          if (a !== active.current) { active.current = a; pushStatus(); }
        }
        const map = posMap.current;
        const haps = m.haps.flatMap((h) => {
          const locs = h.locs.map(([a, b]) => mapRange(map, a, b)).filter((r): r is [number, number] => r !== null);
          return locs.length ? [fakeHap(h.begin, locs, h.value)] : [];
        });
        highlightMiniLocations(v, m.time, haps);
      }),
      runtime.on('error', (m) => setEvalError(new RuntimeError(m.error))),
    ];
    // inline slider moved: @strudel/codemirror posts it on this window; forward to the runtime
    const onSlider = (e: MessageEvent) => {
      if (e.source !== window || e.data?.type !== 'cm-slider' || typeof e.data.id !== 'string' || !Number.isFinite(e.data.value)) return;
      for (const id of sliderIds.current.get(e.data.id) ?? [e.data.id]) void runtime.request({ type: 'slider', id, value: e.data.value });
    };
    window.addEventListener('message', onSlider);
    // strudel.cc shortcuts with Cmd as well as Ctrl: Mod+Enter plays / updates (in the editor and its
    // widgets), Mod+. stops anywhere on the page. Captured before CodeMirror's own Ctrl-Enter binding.
    const rootEl = root.current!;
    const onEditorKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      attempt(update());
    };
    const onPageKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.key !== '.') return;
      e.preventDefault(); e.stopPropagation();
      handle.stop();
    };
    rootEl.addEventListener('keydown', onEditorKey, true);
    window.addEventListener('keydown', onPageKey, true);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('message', onSlider);
      rootEl.removeEventListener('keydown', onEditorKey, true);
      window.removeEventListener('keydown', onPageKey, true);
      v.destroy();
    };
  }, []);

  // editor preferences changed (settings dialog): reconfigure what changed
  useEffect(() => {
    const v = view.current;
    if (!v || appliedPrefs.current === prefs) return;
    v.dispatch({ effects: prefsEffects(prefs, appliedPrefs.current, { editor: v, miniLocations: lastLocs.current }) });
    if (appliedPrefs.current?.fontSize !== prefs.fontSize) v.requestMeasure();
    appliedPrefs.current = prefs;
  }, [prefs]);

  // re-derive the widgets when a section map arrives for the code that is in the editor
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const code = v.state.doc.toString();
    if (inspected && inspected.code !== code) return;   // stale: the next inspect is on its way; marks keep mapping
    const map = inspected?.report.map ?? null;
    songMap.current = map;
    v.dispatch({ effects: setSectionMarks.of({ marks: deriveMarks(code, map), map }) });
  }, [inspected]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const items = (issues ?? []).flatMap((i) => {
      const where = errorLocation(i.message);
      return where ? [{ ...where, message: i.message, severity: i.kind === 'eval_error' ? 'error' as const : 'warning' as const }] : [];
    });
    v.dispatch({ effects: setDiagnostics.of({ source: 'inspect', items }) });
  }, [issues]);

  const run = async (req: Parameters<typeof runtime.request>[0] & { type: 'play' | 'playFrom' | 'loop' }, origin?: CopyOrigin, next: PlayMode = { kind: 'other' }) => {
    const v = view.current!;
    flash(v);
    try {
      const ev = await runtime.request(req);
      mode.current = next;
      active.current = null;
      pushStatus();
      applyEvaluated(ev, origin);
    } catch (e) {
      setEvalError(e);
      throw e;
    }
  };

  const handle: EditorHandle = {
    getCode: () => view.current!.state.doc.toString(),
    setCode: (code) => {
      const v = view.current!;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } }); // onChange fires once, from the update listener
    },
    insertText: (text) => {
      const v = view.current!;
      const { from, to } = v.state.selection.main;
      const at = smartInsert(v.state.doc.toString(), from, to, text);
      v.dispatch({ changes: { from: at.from, to: at.to, insert: at.insert }, selection: { anchor: at.from + at.insert.length }, scrollIntoView: true });
      v.focus();
    },
    getSelection: () => {
      const s = view.current!.state.selection.main;
      return { from: s.from, to: s.to };
    },
    play: (code, origin) => run({ type: 'play', code: code ?? handle.getCode() }, origin, code === undefined ? { kind: 'song' } : { kind: 'other' }),
    playFrom: (startCycle) => {
      const code = handle.getCode();
      const last = lastExpression(code);
      return run({ type: 'playFrom', code, startCycle }, last ? { from: last.from, to: last.to } : undefined, { kind: 'from', startCycle });
    },
    loop: (startCycle, cycles) => {
      const code = handle.getCode();
      const last = lastExpression(code);
      return run({ type: 'loop', code, startCycle, cycles }, last ? { from: last.from, to: last.to } : undefined, { kind: 'loop', startCycle, cycles });
    },
    stop: () => { void runtime.request({ type: 'stop' }); },
    evaluatePattern: async (code) => {
      const { cps } = await runtime.request({ type: 'check', code });
      return { pattern: { code }, cps };
    },
    isPlaying: () => playing.current,
    getView: () => view.current,
    goToLine: (line, col) => jumpTo(view.current!, linePos(view.current!, line, col)),
    jumpTo: (pos) => jumpTo(view.current!, pos),
    edit: ({ from, to, insert }, opts) => {
      const v = view.current!;
      v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input' });
      if (opts?.focus !== false) v.focus();
    },
  };
  useImperativeHandle(ref, () => handle);

  return <div className="editor" ref={root} data-theme={prefs.theme} style={{ fontSize: `${prefs.fontSize}px` }} />;
});

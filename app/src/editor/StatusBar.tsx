// The Code tab's status bar: run selection, the song's sections, visual presets and tempo on the left
// (folded into a "more" menu when the panel is narrow), then the notice, checks and the level meter.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { InspectReport } from '@shawarma/shared';
import type { EditorHandle } from './Editor';
import { CheckBadges } from '../checks/CheckBadges';
import { LevelMeter } from '../meter/LevelMeter';
import { sectionOutline } from './outline';
import { fmtTime } from './sectionWidgets';
import { DEFAULT_CPS, describeTempo, nudgeTempo, readTempo } from './tempo';
import { VISUALS, activeVisuals, toggleVisual } from '../visuals/presets';
import './statusbar.css';

interface Props {
  editor: RefObject<EditorHandle | null>;
  code: string;
  report: InspectReport | null;
  inspected: { report: InspectReport; code: string } | null;
  inspectOffline: boolean;
  notice: string;
  /** Some code is selected: the run button plays only that part, otherwise the whole song. */
  hasSelection: boolean;
  onRunSelection(): void;
  /** The sound browser is shown under the code (instead of in its own tab). */
  splitSounds: boolean;
  onToggleSplitSounds(): void;
  onError(e: unknown): void;
}

/** A <details> popover that closes on Escape and on a click outside it. */
function Popover(props: { label: ReactNode; title: string; ariaLabel?: string; className?: string; children: ReactNode; onOpen?(): void; testId?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const onDown = (e: PointerEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !el.open) return;
      el.open = false;
      el.querySelector('summary')?.focus();
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDown);
    el.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); el.removeEventListener('keydown', onKey); };
  }, []);
  return (
    <details ref={ref} className={`popover status-pop ${props.className ?? ''}`} data-testid={props.testId}
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) props.onOpen?.(); }}>
      <summary className="btn btn-ghost" title={props.title} aria-label={props.ariaLabel}>{props.label}</summary>
      <div className="popover-panel">{props.children}</div>
    </details>
  );
}

function SectionsPanel({ editor, code, inspected, onError }: Pick<Props, 'editor' | 'code' | 'inspected' | 'onError'>) {
  // the map describes the code it was made for; positions come from the current code when it still fits
  const map = inspected?.report.map ?? null;
  const items = sectionOutline(code, map);
  if (!items.length) {
    return <p className="muted status-note">No sections yet. Arrange the song with <code>arrange([cycles, pattern], …)</code>, or ask Shawarma to, and its parts show up here.</p>;
  }
  return (
    <ul className="status-list" aria-label="Sections">
      {items.map(({ section, pos }) => (
        <li key={section.index} className="status-item">
          <button type="button" className="status-item-main" disabled={pos === null} title={pos === null ? 'Not found in the current code' : `Go to ${section.label}`}
            onClick={() => pos !== null && editor.current?.jumpTo(pos)}>
            <span className="status-item-label">{section.label}</span>
            <span className="status-item-meta">{fmtTime(section.startSec)}</span>
          </button>
          <button type="button" className="status-item-play" aria-label={`Play from ${section.label}`} title={`Play from ${section.label}`}
            onClick={() => editor.current?.playFrom(section.startCycle).catch(onError)}>▶</button>
        </li>
      ))}
    </ul>
  );
}

function VisualsPanel({ editor, code }: Pick<Props, 'editor' | 'code'>) {
  const sel = editor.current?.getSelection() ?? { from: 0, to: 0 };
  const on = activeVisuals(code, sel);
  const toggle = (fn: (typeof VISUALS)[number]['fn']) => {
    const e = editor.current;
    if (!e) return;
    const edit = toggleVisual(e.getCode(), e.getSelection(), fn);
    if (edit) e.edit(edit, { focus: false });
  };
  return (
    <>
      <ul className="status-list" aria-label="Visuals">
        {VISUALS.map((v) => (
          <li key={v.fn}>
            <button type="button" aria-pressed={on.has(v.fn)} className="status-item-main status-check" onClick={() => toggle(v.fn)}>
              <span className="status-tick" aria-hidden="true">{on.has(v.fn) ? '✓' : ''}</span>
              <span className="status-item-label">{v.label}</span>
              <code className="status-item-meta">.{v.fn}()</code>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted status-note">Goes on the layer at the cursor, or on the last expression. Press <kbd>⌘</kbd><kbd>⏎</kbd> to see it.</p>
    </>
  );
}

function TempoPanel({ editor, code, cps }: Pick<Props, 'editor' | 'code'> & { cps: number }) {
  const t = readTempo(code);
  const d = describeTempo(t?.cps ?? cps);
  const nudge = (steps: number) => {
    const e = editor.current;
    if (e) e.edit(nudgeTempo(e.getCode(), steps, cps), { focus: false });
  };
  const unit = t?.fn === 'cps' ? '0.01 cps' : t?.den ? '1 bpm' : '1 cpm';
  return (
    <>
      <div className="tempo-row">
        <button type="button" className="btn btn-icon" aria-label="Slower" title={`Slower by ${unit} (Shift: ×5)`} onClick={(e) => nudge(e.shiftKey ? -5 : -1)}>−</button>
        <div className="tempo-value"><strong>{d.cpm}</strong> cpm<span className="muted"> · {d.bpm} bpm</span></div>
        <button type="button" className="btn btn-icon" aria-label="Faster" title={`Faster by ${unit} (Shift: ×5)`} onClick={(e) => nudge(e.shiftKey ? 5 : 1)}>+</button>
      </div>
      <p className="muted status-note">
        {t ? <>Edits <code>{code.slice(t.call.from, t.call.to)}</code> in the code.</> : <>No tempo in the code yet: a nudge adds <code>setcpm(…)</code> on line 1.</>}
        {' '}Press <kbd>⌘</kbd><kbd>⏎</kbd> to hear it. bpm counts 4 beats per cycle.
      </p>
    </>
  );
}

export function StatusBar(props: Props) {
  const { editor, code, report, inspected, inspectOffline, notice, hasSelection, onRunSelection, onError, splitSounds, onToggleSplitSounds } = props;
  const [, rerender] = useState(0);
  const sections = inspected?.report.map?.sections.length ?? 0;
  const t = readTempo(code);
  const cps = t?.cps ?? inspected?.report.map?.cps ?? DEFAULT_CPS;
  const tempo = describeTempo(cps);
  const refresh = () => rerender((n) => n + 1);   // re-read the editor's selection when a menu opens

  const sectionsMenu = (
    <Popover label={<>Sections{sections > 0 && <span className="status-count">{sections}</span>}</>} title="Go to or play a section" testId="sections-menu">
      <SectionsPanel editor={editor} code={code} inspected={inspected} onError={onError} />
    </Popover>
  );
  const visualsMenu = (
    <Popover label="Visuals" title="Add a piano roll, scope or other visual" onOpen={refresh} testId="visuals-menu">
      <VisualsPanel editor={editor} code={code} />
    </Popover>
  );
  const tempoMenu = (
    <Popover label={<span className="tempo-readout">{tempo.cpm} cpm</span>} title={`Tempo: ${tempo.cpm} cycles per minute (${tempo.bpm} bpm at 4 beats per cycle)${t ? '' : ', Strudel\'s default'}`} testId="tempo-menu">
      <TempoPanel editor={editor} code={code} cps={cps} />
    </Popover>
  );

  return (
    <footer className="status">
      <button type="button" className="btn btn-ghost" onClick={onRunSelection} title={hasSelection ? 'Play only the selected part' : 'Play the whole song (⌘⏎)'}>
        {hasSelection ? '▶ Run selection' : '▶ Run all'}
      </button>
      <div className="status-group status-tools">
        {sectionsMenu}
        {visualsMenu}
        {tempoMenu}
      </div>
      <Popover className="status-more" label="⋯" ariaLabel="More tools" title="Sections, visuals and tempo" onOpen={refresh}>
        <h4>Sections</h4>
        <SectionsPanel editor={editor} code={code} inspected={inspected} onError={onError} />
        <h4>Visuals</h4>
        <VisualsPanel editor={editor} code={code} />
        <h4>Tempo</h4>
        <TempoPanel editor={editor} code={code} cps={cps} />
      </Popover>
      <button type="button" className="btn btn-ghost split-toggle" aria-pressed={splitSounds} onClick={onToggleSplitSounds}
        title={splitSounds ? 'Move the sounds back to their own tab' : 'Show the sounds under the code'}>
        <SplitIcon /><span className="split-label">Sounds below</span>
      </button>
      <span className="keys"><kbd>⌘</kbd><kbd>⏎</kbd> play <kbd>⌘</kbd><kbd>.</kbd> stop</span>
      <span className="notice" title={notice} role="status">{notice}</span>
      <div className="status-group status-health">
        <CheckBadges report={report} offline={inspectOffline} />
        <LevelMeter />
      </div>
    </footer>
  );
}

const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M1.5 7.5h11" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2.2" y="8.2" width="9.6" height="3.6" rx="1" fill="currentColor" opacity="0.45" />
  </svg>
);

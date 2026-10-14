import { useMemo } from 'react';
import type { SongMap } from '@shawarma/shared';
import { type ExportRange, ExportRangeError, rangeSeconds, resolveRange } from './range';
import { formatDuration } from './ExportsTab';

/** UI state of the range picker (cycle fields stay text while typing). */
export interface RangeChoice { kind: 'all' | 'section' | 'cycles'; section: number; from: string; to: string }
export const DEFAULT_RANGE: RangeChoice = { kind: 'all', section: 0, from: '0', to: '8' };

export function toExportRange(c: RangeChoice): ExportRange {
  if (c.kind === 'section') return { kind: 'section', index: c.section };
  if (c.kind === 'cycles') return { kind: 'cycles', from: c.from.trim() === '' ? NaN : Number(c.from), to: c.to.trim() === '' ? NaN : Number(c.to) };
  return { kind: 'all' };
}

/** The export popover's body: what to render (whole song, a section, or cycles) and the small-copy option. */
export function ExportOptions(props: {
  map: SongMap | null; choice: RangeChoice; onChoice(c: RangeChoice): void; small: boolean; onSmall(v: boolean): void;
}) {
  const { map, choice } = props;
  const set = (patch: Partial<RangeChoice>) => props.onChoice({ ...choice, ...patch });
  const preview = useMemo(() => {
    try {
      const r = resolveRange(toExportRange(choice), map);
      return { text: map ? `${formatDuration(rangeSeconds(r, map.cps))} · cycles ${r.from}–${r.to}` : `cycles ${r.from}–${r.to}`, error: '' };
    } catch (e) {
      return { text: '', error: e instanceof ExportRangeError ? e.message : String(e) };
    }
  }, [choice, map]);
  const sections = map?.sections ?? [];
  return (
    <div className="export-options">
      <fieldset className="export-range">
        <legend>What to export</legend>
        <label className="check">
          <input type="radio" name="export-range" checked={choice.kind === 'all'} onChange={() => set({ kind: 'all' })} />
          Whole song
        </label>
        <label className="check">
          <input type="radio" name="export-range" checked={choice.kind === 'section'} disabled={!sections.length} onChange={() => set({ kind: 'section' })} />
          Section
        </label>
        {choice.kind === 'section' && sections.length > 0 && (
          <select className="export-select" aria-label="Which section" value={Math.min(choice.section, sections.length - 1)} onChange={(e) => set({ section: Number(e.target.value) })}>
            {sections.map((s, i) => <option key={i} value={i}>{i + 1}. {s.label.trim() || `Section ${i + 1}`} ({s.cycles} cycles)</option>)}
          </select>
        )}
        {!sections.length && <p className="muted hint">Sections come from arrange() in the song.</p>}
        <label className="check">
          <input type="radio" name="export-range" checked={choice.kind === 'cycles'} onChange={() => set({ kind: 'cycles', to: choice.kind === 'cycles' ? choice.to : String(map?.totalCycles ?? 8) })} />
          Cycles
        </label>
        {choice.kind === 'cycles' && (
          <div className="row cycle-fields">
            <label>From <input type="number" min={0} step={1} value={choice.from} aria-label="Start cycle" onChange={(e) => set({ from: e.target.value })} /></label>
            <label>to <input type="number" min={0} step={1} value={choice.to} aria-label="End cycle" onChange={(e) => set({ to: e.target.value })} /></label>
          </div>
        )}
        {preview.error ? <p role="alert" className="err-text">{preview.error}</p> : <p className="muted hint" aria-live="polite">{preview.text}</p>}
      </fieldset>
      <label className="check"><input type="checkbox" checked={props.small} onChange={(e) => props.onSmall(e.target.checked)} />Also make a small copy (&lt;20 MB)</label>
      <p className="muted">Exports a 24-bit WAV and an MP3 into the project folder.</p>
    </div>
  );
}

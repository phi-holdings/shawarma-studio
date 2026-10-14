import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getRuntime } from '../runtime/client';
import { consoleStore, matchesFilter, useConsole, type ConsoleEntry, type ConsoleFilter } from './store';
import './console.css';

const FILTERS: { id: ConsoleFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'errors', label: 'Errors' },
  { id: 'warnings', label: 'Warnings' },
  { id: 'song', label: 'Song output' },
];

const KIND_LABEL: Record<ConsoleEntry['kind'], string> = { error: 'Error', warning: 'Warning', notice: 'Notice', song: 'Song' };
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const tone = (e: ConsoleEntry) => (e.kind === 'song' ? (e.level === 'error' ? 'error' : e.level === 'warn' ? 'warning' : 'song') : e.kind);

/** Forwards the runtime's live evaluation errors and the song's log output into the console store. */
function useRuntimeFeed() {
  useEffect(() => {
    const rt = getRuntime();
    const offs = [
      rt.on('error', (m) => consoleStore.push({ kind: 'error', source: 'eval', message: m.error.message, line: m.error.line, col: m.error.col })),
      rt.on('log', (m) => consoleStore.push({ kind: 'song', source: 'song', level: m.level, message: m.message })),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

/** Unread error count for the Console tab label. */
export function ConsoleBadge() {
  const { unreadErrors } = useConsole();
  if (!unreadErrors) return null;
  return <span className="tab-count" aria-label={`${unreadErrors} new error${unreadErrors === 1 ? '' : 's'}`}>{unreadErrors > 99 ? '99+' : unreadErrors}</span>;
}

export function ConsoleTab(props: { visible: boolean; onJump(line: number, col?: number): void }) {
  useRuntimeFeed();
  const { entries } = useConsole();
  const [filter, setFilter] = useState<ConsoleFilter>('all');
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);   // follow new output while scrolled to the bottom

  useEffect(() => { consoleStore.setReading(props.visible); return () => consoleStore.setReading(false); }, [props.visible]);

  const shown = entries.filter((e) => matchesFilter(e, filter));
  const count = (f: ConsoleFilter) => entries.filter((e) => matchesFilter(e, f)).length;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, props.visible, filter]);

  // the log is only in the page while the tab is open: its text never doubles a notice shown elsewhere
  if (!props.visible) return null;
  return (
    <div className="console">
      <div className="console-bar">
        <div className="console-filters" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => {
            const n = f.id === 'all' ? entries.length : count(f.id);
            return (
              <button key={f.id} type="button" role="radio" aria-checked={filter === f.id}
                className={`console-filter${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}{n > 0 && <span className="console-n">{n}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-outline" onClick={() => consoleStore.clear()} disabled={!entries.length}>Clear</button>
      </div>
      {shown.length === 0 ? (
        <div className="console-empty muted">
          {entries.length === 0
            ? <p>Nothing logged yet. Errors, check warnings and save or export notices land here. Add <code>.log()</code> to a pattern, or <code>console.log()</code> in the code, and play the song to see its output.</p>
            : <p>Nothing matches this filter. <button type="button" className="link" onClick={() => setFilter('all')}>Show everything</button></p>}
        </div>
      ) : (
        <ol className="console-list" ref={list} aria-label="Console messages" aria-live="polite"
          onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {shown.map((e) => (
            <li key={e.id} className={`console-row tone-${tone(e)}`}>
              <span className="console-time">{time(e.time)}</span>
              <span className="console-kind">{KIND_LABEL[e.kind]}</span>
              <span className="console-msg">{e.message}</span>
              {e.count > 1 && <span className="console-repeat" title={`${e.count} times`}>×{e.count}</span>}
              {e.line !== undefined && (
                <button type="button" className="console-line" onClick={() => props.onJump(e.line!, e.col)} title="Show this line in the code">
                  Line {e.line}{e.col !== undefined ? `:${e.col}` : ''}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

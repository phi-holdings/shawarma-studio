// The Console tab's log: evaluation errors, check warnings, app notices and the song's own output.
// A small observable store so anything (App's notices, the runtime wiring) can write to it.
import { useSyncExternalStore } from 'react';

export type EntryKind = 'error' | 'warning' | 'notice' | 'song';
export type SongLevel = 'info' | 'warn' | 'error';
/** Where an entry came from: inspect entries are replaced as a set by each new check. */
export type EntrySource = 'eval' | 'inspect' | 'app' | 'song';

export interface ConsoleEntry {
  id: number;
  time: number;
  kind: EntryKind;
  source: EntrySource;
  message: string;
  /** 1-based editor position the entry points at, when known. */
  line?: number;
  col?: number;
  /** For song output: the console method used. */
  level?: SongLevel;
  /** How many times in a row this same entry arrived. */
  count: number;
}

export type NewEntry = Omit<ConsoleEntry, 'id' | 'time' | 'count'>;
export type ConsoleFilter = 'all' | 'errors' | 'warnings' | 'song';

export const MAX_ENTRIES = 500;
/** The same message again within this window counts as a repeat (e.g. a play error reported twice). */
const REPEAT_MS = 1500;

export interface ConsoleState { entries: ConsoleEntry[]; unreadErrors: number }

const isError = (e: Pick<ConsoleEntry, 'kind' | 'level'>) => e.kind === 'error' || (e.kind === 'song' && e.level === 'error');

export function matchesFilter(e: ConsoleEntry, f: ConsoleFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'errors': return isError(e);
    case 'warnings': return e.kind === 'warning' || (e.kind === 'song' && e.level === 'warn');
    case 'song': return e.kind === 'song';
  }
}

export function createConsoleStore(now: () => number = Date.now) {
  let state: ConsoleState = { entries: [], unreadErrors: 0 };
  let nextId = 1;
  let reading = false;       // the Console tab is on screen: errors are seen as they arrive
  const subs = new Set<() => void>();
  const commit = (entries: ConsoleEntry[], newErrors: number) => {
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
    state = { entries: trimmed, unreadErrors: reading ? 0 : state.unreadErrors + newErrors };
    subs.forEach((fn) => fn());
  };
  const make = (e: NewEntry, t: number): ConsoleEntry => ({ ...e, id: nextId++, time: t, count: 1 });
  const same = (a: ConsoleEntry, b: NewEntry) => a.kind === b.kind && a.message === b.message && a.level === b.level && a.line === b.line;

  return {
    get: () => state,
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },

    push(e: NewEntry) {
      const t = now();
      const last = state.entries[state.entries.length - 1];
      if (last && same(last, e)) {
        // a song repeating itself is counted; the same error reported by two paths at once is one error
        if (e.kind !== 'song' && t - last.time < REPEAT_MS) return;
        const bumped = { ...last, count: last.count + 1, time: t };
        commit([...state.entries.slice(0, -1), bumped], isError(e) ? 1 : 0);
        return;
      }
      commit([...state.entries, make(e, t)], isError(e) ? 1 : 0);
    },

    /** Replaces every entry of `source` with `items` (unchanged items keep their place and are not new). */
    replaceSource(source: EntrySource, items: Omit<NewEntry, 'source'>[]) {
      const old = state.entries.filter((e) => e.source === source);
      const key = (e: Omit<NewEntry, 'source'>) => `${e.kind}|${e.line ?? ''}|${e.message}`;
      const oldKeys = new Set(old.map(key));
      const newKeys = new Set(items.map(key));
      if (old.length === items.length && items.every((i) => oldKeys.has(key(i)))) return;
      const kept = state.entries.filter((e) => e.source !== source || newKeys.has(key(e)));
      const t = now();
      const added = items.filter((i) => !oldKeys.has(key(i))).map((i) => make({ ...i, source }, t));
      commit([...kept, ...added], added.filter(isError).length);
    },

    clear() { state = { entries: [], unreadErrors: 0 }; subs.forEach((fn) => fn()); },

    /** The Console tab is (not) visible; while it is, errors are not counted as unread. */
    setReading(on: boolean) {
      reading = on;
      if (on && state.unreadErrors) { state = { ...state, unreadErrors: 0 }; subs.forEach((fn) => fn()); }
    },
  };
}

export type ConsoleStore = ReturnType<typeof createConsoleStore>;
export const consoleStore = createConsoleStore();

export const useConsole = (): ConsoleState => useSyncExternalStore(consoleStore.subscribe, consoleStore.get);

/** A notice that reports a failure (shown and kept as an error). */
export const isFailureNotice = (m: string) => /\b(failed|could not|couldn't|can't|cannot|error)\b/i.test(m);

/** App notices: what the status line says, also kept in the console. Failures count as errors. */
export function logNotice(message: string) {
  if (!message.trim() || /^(Exporting…|Running:)/.test(message)) return;
  consoleStore.push({ kind: isFailureNotice(message) ? 'error' : 'notice', source: 'app', message });
}

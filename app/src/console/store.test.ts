import { expect, test } from 'vitest';
import { createConsoleStore, MAX_ENTRIES, matchesFilter } from './store';

const clock = () => { let t = 1000; return { now: () => t, tick: (ms: number) => { t += ms; } }; };

test('push adds entries; errors count as unread until the console is read', () => {
  const c = clock();
  const s = createConsoleStore(c.now);
  s.push({ kind: 'notice', source: 'app', message: 'Saved v1' });
  s.push({ kind: 'error', source: 'eval', message: 'Unexpected token (2:3)', line: 2, col: 4 });
  expect(s.get().entries.map((e) => e.message)).toEqual(['Saved v1', 'Unexpected token (2:3)']);
  expect(s.get().unreadErrors).toBe(1);
  s.setReading(true);
  expect(s.get().unreadErrors).toBe(0);
  s.push({ kind: 'error', source: 'eval', message: 'other' });
  expect(s.get().unreadErrors).toBe(0);
  s.setReading(false);
  s.push({ kind: 'song', source: 'song', level: 'error', message: 'boom' });
  expect(s.get().unreadErrors).toBe(1);
});

test('the same error from two paths at once is one entry; song repeats are counted', () => {
  const c = clock();
  const s = createConsoleStore(c.now);
  s.push({ kind: 'error', source: 'eval', message: 'x is not defined' });
  s.push({ kind: 'error', source: 'app', message: 'x is not defined' });
  expect(s.get().entries).toHaveLength(1);
  expect(s.get().unreadErrors).toBe(1);
  c.tick(5000);
  s.push({ kind: 'error', source: 'eval', message: 'x is not defined' });
  expect(s.get().entries[0].count).toBe(2);
  s.push({ kind: 'song', source: 'song', level: 'info', message: 'tick' });
  s.push({ kind: 'song', source: 'song', level: 'info', message: 'tick' });
  expect(s.get().entries).toHaveLength(2);
  expect(s.get().entries[1].count).toBe(2);
});

test('replaceSource swaps the check results as a set, keeping unchanged ones', () => {
  const s = createConsoleStore(clock().now);
  s.replaceSource('inspect', [{ kind: 'error', message: 'a (1:1)', line: 1 }, { kind: 'warning', message: 'unknown sound' }]);
  expect(s.get().unreadErrors).toBe(1);
  const firstId = s.get().entries[0].id;
  s.replaceSource('inspect', [{ kind: 'error', message: 'a (1:1)', line: 1 }, { kind: 'warning', message: 'unknown sound' }]);
  expect(s.get().unreadErrors).toBe(1);   // nothing new
  s.replaceSource('inspect', [{ kind: 'error', message: 'a (1:1)', line: 1 }]);
  expect(s.get().entries.map((e) => e.id)).toEqual([firstId]);
  s.replaceSource('inspect', []);
  expect(s.get().entries).toEqual([]);
});

test('filters, clear and the size cap', () => {
  const s = createConsoleStore(clock().now);
  s.push({ kind: 'warning', source: 'inspect', message: 'w' });
  s.push({ kind: 'song', source: 'song', level: 'warn', message: 'sw' });
  s.push({ kind: 'notice', source: 'app', message: 'n' });
  const [w, sw, n] = s.get().entries;
  expect([w, sw, n].map((e) => matchesFilter(e, 'warnings'))).toEqual([true, true, false]);
  expect([w, sw, n].map((e) => matchesFilter(e, 'song'))).toEqual([false, true, false]);
  expect([w, sw, n].map((e) => matchesFilter(e, 'errors'))).toEqual([false, false, false]);
  s.clear();
  expect(s.get()).toEqual({ entries: [], unreadErrors: 0 });
  for (let i = 0; i < MAX_ENTRIES + 20; i++) s.push({ kind: 'song', source: 'song', level: 'info', message: `m${i}` });
  expect(s.get().entries).toHaveLength(MAX_ENTRIES);
  expect(s.get().entries.at(-1)!.message).toBe(`m${MAX_ENTRIES + 19}`);
});

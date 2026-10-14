import { expect, test, vi } from 'vitest';
import { DEFAULT_PREFS, FONT_SIZES, PREFS_KEY, createPrefsStore, parsePrefs } from './prefs';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

test('defaults when nothing (or garbage) is stored', () => {
  expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('[1,2]')).toEqual(DEFAULT_PREFS);
});

test('each malformed field falls back on its own; font size is clamped', () => {
  const p = parsePrefs(JSON.stringify({ theme: 'neon', keybindings: 'vim', lineNumbers: 'yes', lineWrap: false, fontSize: 99 }));
  expect(p).toEqual({ ...DEFAULT_PREFS, keybindings: 'vim', lineWrap: false, fontSize: FONT_SIZES.max });
  expect(parsePrefs(JSON.stringify({ fontSize: 2 })).fontSize).toBe(FONT_SIZES.min);
  expect(parsePrefs(JSON.stringify({ fontSize: '16' })).fontSize).toBe(DEFAULT_PREFS.fontSize);
});

test('set persists, notifies and survives a reload; reset restores the defaults', () => {
  const storage = memory();
  const a = createPrefsStore(storage);
  const fn = vi.fn();
  a.subscribe(fn);
  a.set({ theme: 'paper', fontSize: 16, autocomplete: false });
  expect(fn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.m.get(PREFS_KEY)!)).toMatchObject({ theme: 'paper', fontSize: 16, autocomplete: false });
  const b = createPrefsStore(storage);   // a new page load
  expect(b.get()).toEqual({ ...DEFAULT_PREFS, theme: 'paper', fontSize: 16, autocomplete: false });
  b.reset();
  expect(createPrefsStore(storage).get()).toEqual(DEFAULT_PREFS);
});

test('a storage that throws (private mode) keeps prefs in memory', () => {
  const s = createPrefsStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  s.set({ lineNumbers: false });
  expect(s.get().lineNumbers).toBe(false);
});

test('themes from before the redesign map to the new ones', () => {
  expect(parsePrefs(JSON.stringify({ theme: 'aubergine' })).theme).toBe('desk');
  expect(parsePrefs(JSON.stringify({ theme: 'toum' })).theme).toBe('paper');
  expect(parsePrefs(JSON.stringify({ theme: 'night' })).theme).toBe('night');
});

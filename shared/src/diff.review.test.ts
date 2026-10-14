import { expect, test } from 'vitest';
import { contextAround, lineAt, scopeLabel, sectionAt, wordDiff } from './diff';

const song = [
  'setcpm(30)',
  '// ==== Drums ====',
  'const drums = s("bd sd")',
  '// ==== Keys ====',
  'const keys = note("c e g").s("piano")',
  'arrange([4, drums], // Drums',
  '  [4, keys]) // Keys',
  '',
].join('\n');

test('wordDiff marks only the changed words', () => {
  const parts = wordDiff('a b c', 'a x c');
  expect(parts.filter((p) => p.kind !== 'same').map((p) => [p.kind, p.text])).toEqual([['del', 'b'], ['add', 'x']]);
  expect(parts.map((p) => (p.kind === 'del' ? '' : p.text)).join('')).toBe('a x c');
});

test('lineAt and contextAround', () => {
  expect(lineAt('a\nb\nc', 0)).toBe(1);
  expect(lineAt('a\nb\nc', 2)).toBe(2);
  expect(lineAt('a\nb\nc', 99)).toBe(3);
  const code = 'l1\nl2\nl3\nl4\nl5\nl6\n';
  const from = code.indexOf('l4');
  expect(contextAround(code, from, from + 3)).toEqual({ before: ['l2', 'l3'], after: ['l5', 'l6'] });
  expect(contextAround(code, 0, 3)).toEqual({ before: [], after: ['l2', 'l3'] });
});

test('sectionAt finds the section of a definition, of an arrange entry, and none before the first', () => {
  expect(sectionAt(song, song.indexOf('bd sd'))).toBe('Drums');
  expect(sectionAt(song, song.indexOf('piano'))).toBe('Keys');
  expect(sectionAt(song, song.indexOf('[4, keys]') + 2)).toBe('Keys');
  expect(sectionAt(song, 0)).toBeNull();
  expect(sectionAt('s("bd")', 2)).toBeNull();
  expect(sectionAt('this is ( not code', 2)).toBeNull();
});

test('scopeLabel shows lines and the section', () => {
  const from = song.indexOf('const keys');
  expect(scopeLabel(song, { from, to: from + 10 })).toBe('Line 5 · Keys');
  expect(scopeLabel(song, { from: 0, to: song.indexOf('const keys') })).toBe('Lines 1–4');
  const d = song.indexOf('// ==== Drums');
  expect(scopeLabel(song, { from: d, to: song.indexOf('// ==== Keys') })).toBe('Lines 2–3 · Drums');
});

import { expect, test } from 'vitest';
import { arrangeInfo, arrangeLabels, arrangeLayout, lastExpression, snapToExpression } from './ast';

const song = `setcpm(30)
const lead = note("c4 e4").s("piano")
const pads = (key) => note("<c3 e3>").s("supersaw")
arrange(
  [8, lead],        // I. intro
  [4, pads('minor')],
  [2, silence]      // end
)`;

test('snaps a partial selection to the enclosing call expression', () => {
  const at = song.indexOf('pads(') + 2;           // inside "pads"
  const r = snapToExpression(song, { from: at, to: at + 4 })!;
  expect(r.text).toBe("pads('minor')");
});

test('keeps an exact expression selection', () => {
  const from = song.indexOf('note("c4 e4")');
  const r = snapToExpression(song, { from, to: from + 'note("c4 e4").s("piano")'.length })!;
  expect(r.text).toBe('note("c4 e4").s("piano")');
});

test('a string literal argument snaps to its call', () => {
  const at = song.indexOf('c4 e4');
  expect(snapToExpression(song, { from: at, to: at + 2 })!.text).toBe('note("c4 e4")');
});

test('returns null for unparseable code', () => {
  expect(snapToExpression('stack(', { from: 0, to: 3 })).toBeNull();
});

test('lastExpression finds the final top-level expression', () => {
  expect(lastExpression(song)!.text.startsWith('arrange(')).toBe(true);
});

test('arrangeLabels prefers trailing comments, then the pattern source', () => {
  expect(arrangeLabels(song)).toEqual(['I. intro', "pads('minor')", 'end']);
});

test('arrangeLabels returns null when a spread argument hides the section count', () => {
  expect(arrangeLabels('const s=[[1,a]]\narrange(...s, [2, b])')).toBeNull();
});

test('a comment after two sections on one line labels only the nearest preceding section', () => {
  const code = 'arrange(\n  [4, a], [4, b], // shared\n  [2, c] // end\n)';
  expect(arrangeLabels(code)).toEqual(['a', 'shared', 'end']);
  expect(arrangeLabels('arrange([4, a], [4, b]) // tail')).toEqual(['a', 'tail']);
});

test('holey section arrays do not throw', () => {
  expect(arrangeLabels('arrange([ , x], [2, y])')).toEqual(['x', 'y']);
  expect(arrangeLabels('arrange([4, , x], [2, y]) // end')).toEqual(['Section 1', 'end']);
  expect(() => arrangeInfo('arrange([,,])')).not.toThrow();
});

test('multiple top-level arrange() calls: the last one is used and the count reported', () => {
  const code = 'const a = arrange([1, x]) // first\narrange([2, y], [3, z]) // last';
  expect(arrangeInfo(code)).toEqual({ labels: ['y', 'last'], calls: 2 });
  // an arrangement nested in a section is part of it, not a second call
  expect(arrangeInfo('arrange([4, arrange([1, a], [1, b])], [2, c])')).toEqual({ labels: ['arrange([1, a], [1, b])', 'c'], calls: 1 });
  expect(arrangeInfo('s("bd")')).toEqual({ labels: null, calls: 0 });
});

test('arrangeLayout: entry ranges, the call start and matching header comments', async () => {
  const { arrangeLayout } = await import('./ast');
  const code = `setcpm(30)
// ==== HYMN I: CHOIR A CAPPELLA ====
const hymn = note("c4").s("piano")
// verse
const verse = note("e4").s("piano")
// ---- outro ----
arrange(
  [8, hymn],   // Hymn I: choir a cappella
  [4, verse],
  [2, s("bd")] // outro
)`;
  const l = arrangeLayout(code)!;
  expect(l.call).toBe(code.indexOf('arrange('));
  expect(l.entries.map((e) => code.slice(e.from, e.to))).toEqual(['[8, hymn]', '[4, verse]', '[2, s("bd")]']);
  expect(l.headers).toEqual([code.indexOf('// ===='), code.indexOf('// verse'), code.indexOf('// ----')]);
  // a prefix of the header matches; non-identifier source labels and used headers do not
  const two = '// == INTRO: soft ==\n// intro again\narrange([4, a], // intro\n [4, b]) // intro';
  expect(arrangeLayout(two)!.headers).toEqual([0, two.indexOf('// intro again')]);
  expect(arrangeLayout('// s bd\narrange([1, s("bd")], [1, x])')!.headers).toEqual([null, null]);
  expect(arrangeLayout('s("bd")')).toBeNull();
});

test('arrangeLayout anchors sections to their definitions and the banner above them when labels differ', () => {
  const code = [
    '// ===== HYMN I: CHOIR A CAPPELLA (SATB) =====',
    'const satb = note("c")',
    'const hymnChoir = stack(satb)',
    '// ===== HYMN II: DUDUK + CHOIR =====',
    'const hymnDuduk = note("d")',
    'const extra = note("e")',
    'arrange(',
    '  [8, hymnChoir], // I.   choir a cappella',
    '  [8, hymnDuduk], // II.  duduk over choir',
    '  [4, extra],     // something else',
    ')',
  ].join('\n');
  const l = arrangeLayout(code)!;
  const lineOf = (pos: number | null) => (pos === null ? null : code.slice(0, pos).split('\n').length);
  expect(l.defs.map(lineOf)).toEqual([3, 5, 6]);
  expect(l.headers.map(lineOf)).toEqual([1, 4, null]);
});

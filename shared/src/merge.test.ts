import { describe, expect, test } from 'vitest';
import { applyMerge, defaultChoice, merge3, splitLines } from './merge';

const base = 'a\nb\nc\nd\ne\n';

describe('splitLines', () => {
  test('keeps line endings and a last line without one', () => {
    expect(splitLines('a\nb')).toEqual(['a\n', 'b']);
    expect(splitLines('a\n')).toEqual(['a\n']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('merge3', () => {
  test('an unchanged buffer: every change of the proposal is a clean hunk', () => {
    const r = merge3(base, 'a\nB\nc\nd\nE\n', base);
    expect(r.clean).toBe(true);
    expect(r.hunks.map((h) => [h.kind, h.current, h.proposed, h.line])).toEqual([
      ['clean', 'b\n', 'B\n', 2],
      ['clean', 'e\n', 'E\n', 5],
    ]);
    expect(applyMerge(r)).toBe('a\nB\nc\nd\nE\n');
    expect(applyMerge(r, new Set([0]))).toBe('a\nB\nc\nd\ne\n');
    expect(applyMerge(r, new Set())).toBe(base);
  });

  test('user edits elsewhere are kept and the proposal applies around them', () => {
    const current = 'a\nb\nC (mine)\nd\ne\n';
    const r = merge3(base, 'a\nB\nc\nd\nE\n', current);
    expect(r.clean).toBe(true);
    expect(applyMerge(r)).toBe('a\nB\nC (mine)\nd\nE\n');
    // the hunks are positioned in the current buffer
    expect(r.hunks[1].offset).toBe(current.indexOf('e\n'));
  });

  test('adjacent edits on different lines do not conflict', () => {
    const r = merge3(base, 'a\nB\nc\nd\ne\n', 'a\nb\nC\nd\ne\n');
    expect(r.clean).toBe(true);
    expect(applyMerge(r)).toBe('a\nB\nC\nd\ne\n');
  });

  test('both sides changing the same line is a conflict that keeps the user text by default', () => {
    const r = merge3(base, 'a\nB\nc\nd\nE\n', 'a\nb mine\nc\nd\ne\n');
    expect(r.clean).toBe(false);
    expect(r.hunks.map((h) => h.kind)).toEqual(['conflict', 'clean']);
    expect(r.hunks[0]).toMatchObject({ current: 'b mine\n', proposed: 'B\n', base: 'b\n', line: 2 });
    // the non-conflicting hunk still applies
    expect(applyMerge(r)).toBe('a\nb mine\nc\nd\nE\n');
    expect(defaultChoice(r)).toEqual(new Set([1]));
    // a conflict can be switched to Claude's text, per hunk
    expect(applyMerge(r, new Set([0, 1]))).toBe('a\nB\nc\nd\nE\n');
  });

  test('the same edit on both sides is not a hunk', () => {
    const r = merge3(base, 'a\nB\nc\nd\ne\n', 'a\nB\nc\nd\ne\n');
    expect(r.hunks).toEqual([]);
    expect(applyMerge(r)).toBe('a\nB\nc\nd\ne\n');
  });

  test('insertions at the same place conflict, insertions elsewhere do not', () => {
    const same = merge3(base, 'a\nX\nb\nc\nd\ne\n', 'a\nY\nb\nc\nd\ne\n');
    expect(same.hunks.map((h) => h.kind)).toEqual(['conflict']);
    expect(applyMerge(same)).toBe('a\nY\nb\nc\nd\ne\n');
    expect(applyMerge(same, new Set([0]))).toBe('a\nX\nb\nc\nd\ne\n');

    const apart = merge3(base, 'a\nX\nb\nc\nd\ne\n', 'a\nb\nc\nd\nY\ne\n');
    expect(apart.clean).toBe(true);
    expect(applyMerge(apart)).toBe('a\nX\nb\nc\nd\nY\ne\n');
  });

  test('a user insertion inside a range Claude replaced is a conflict', () => {
    const r = merge3(base, 'a\nBCD\ne\n', 'a\nb\nnew\nc\nd\ne\n');
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]).toMatchObject({ kind: 'conflict', current: 'b\nnew\nc\nd\n', proposed: 'BCD\n' });
  });

  test('a last line without a newline', () => {
    const r = merge3('s("bd sd")', 's("bd sd cp")', 's("bd sd")');
    expect(applyMerge(r)).toBe('s("bd sd cp")');
    const edited = merge3('s("bd sd")', 's("bd sd cp")', 's("bd sd hh")');
    expect(edited.hunks[0].kind).toBe('conflict');
    expect(applyMerge(edited)).toBe('s("bd sd hh")');
  });

  test('a user line appended after a file without a final newline does not lose Claude\'s first-line edit', () => {
    const r = merge3('a\nb', 'A\nb', 'a\nb\nc');
    expect(applyMerge(r)).toBe('A\nb\nc');
  });

  test('deletions', () => {
    const r = merge3(base, 'a\nd\ne\n', 'a\nb\nc\nd\ne\nf\n');
    expect(r.clean).toBe(true);
    expect(applyMerge(r)).toBe('a\nd\ne\nf\n');
  });
});

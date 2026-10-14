import { expect, test } from 'vitest';
import { merge3 } from '@shawarma/shared';
import { hunkRows, segLines } from './hunkView';

test('segLines splits on newlines and keeps the marks', () => {
  expect(segLines([{ text: 'a ', hl: false }, { text: 'b\nc', hl: true }, { text: '\n', hl: false }])).toEqual([
    [{ text: 'a ', hl: false }, { text: 'b', hl: true }],
    [{ text: 'c', hl: true }],
  ]);
});

test('a one-word change: context, numbered old line with the word marked, new line', () => {
  const code = 'l1\nl2\nl3\ns("bd sd")\nl5\nl6\nl7\n';
  const m = merge3(code, code.replace('bd sd', 'bd sd cp'), code);
  const rows = hunkRows(code, m.hunks[0]);
  expect(rows.map((r) => [r.kind, r.n])).toEqual([['ctx', 2], ['ctx', 3], ['del', 4], ['add', null], ['ctx', 5], ['ctx', 6]]);
  const add = rows.find((r) => r.kind === 'add')!;
  expect(add.segs.map((s) => s.text).join('')).toBe('s("bd sd cp")');
  expect(add.segs.some((s) => s.hl && s.text.includes('cp'))).toBe(true);
  expect(add.segs.some((s) => !s.hl && s.text.includes('s("bd'))).toBe(true);
});

test('an insertion has no removed rows; a rewrite is not word-marked', () => {
  const code = 'a\nb\n';
  const ins = hunkRows(code, merge3(code, 'a\nnew\nb\n', code).hunks[0]);
  expect(ins.map((r) => r.kind)).toEqual(['ctx', 'add', 'ctx']);
  const rw = hunkRows('x\n', merge3('x\n', 'completely different\n', 'x\n').hunks[0]);
  expect(rw.every((r) => r.segs.every((s) => !s.hl))).toBe(true);
});

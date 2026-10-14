import { describe, expect, test } from 'vitest';
import { applyEdit, applyFindReplace, EditError, findUnique } from './edits';

const code = `const a = s("bd sd")\nconst b = s("hh*8")\nstack(a, b)`;

describe('findUnique', () => {
  test('returns the range of a single match', () => {
    expect(findUnique(code, 's("hh*8")')).toEqual({ from: 31, to: 40 });
  });
  test('throws when text is missing', () => {
    expect(() => findUnique(code, 'nope')).toThrow(EditError);
  });
  test('throws when text occurs twice', () => {
    expect(() => findUnique(code, 's("')).toThrow(/2 times/);
  });
});

describe('applyFindReplace', () => {
  test('replaces and reports the new range and length delta', () => {
    const r = applyFindReplace(code, 'hh*8', 'hh*16');
    expect(r.code).toContain('s("hh*16")');
    expect(r.range).toEqual({ from: 34, to: 39 });
    expect(r.delta).toBe(1);
  });
  test('rejects a match outside the allowed range', () => {
    expect(() => applyFindReplace(code, 'hh*8', 'x', { from: 0, to: 20 })).toThrow(/outside the selected/);
  });
  test('accepts a match inside the allowed range', () => {
    expect(applyFindReplace(code, 'bd sd', 'bd bd', { from: 0, to: 20 }).code).toContain('"bd bd"');
  });
});

describe('applyFindReplace within a selection', () => {
  const twice = `const a = s("bd sd").gain(0.8)\nconst b = s("bd sd").gain(0.8)\nstack(a, b)`;
  const second = { from: twice.indexOf('const b'), to: twice.indexOf('\nstack') };

  test('a text repeated elsewhere is unique inside the selection and edits that occurrence', () => {
    const r = applyFindReplace(twice, 'gain(0.8)', 'gain(0.5)', second);
    expect(r.code).toBe(`const a = s("bd sd").gain(0.8)\nconst b = s("bd sd").gain(0.5)\nstack(a, b)`);
    expect(r.range.from).toBe(twice.lastIndexOf('gain(0.8)'));
    expect(r.code.slice(r.range.from, r.range.to)).toBe('gain(0.5)');
  });

  test('repeated inside the selection is still ambiguous', () => {
    expect(() => applyFindReplace(twice, 'd', 'x', second)).toThrow(/2 times.*selection/);
  });

  test('text only outside the selection is reported as outside; missing text as not found', () => {
    expect(() => applyFindReplace(twice, 'stack(a, b)', 'x', second)).toThrow(/outside the selected/);
    expect(() => applyFindReplace(twice, 'nope', 'x', second)).toThrow(/not found/);
  });

  test('a match straddling the selection edge is not inside it', () => {
    expect(() => applyFindReplace(twice, '0.8)\nstack', 'x', second)).toThrow(/outside the selected/);
  });
});

describe('applyEdit with a {from, to} range', () => {
  test('replaces the range and reports the new range and delta', () => {
    const from = code.indexOf('hh*8');
    const r = applyEdit(code, { from, to: from + 4, replace: 'hh*16' });
    expect(r.code).toContain('s("hh*16")');
    expect(r.range).toEqual({ from, to: from + 5 });
    expect(r.delta).toBe(1);
  });
  test('an empty range inserts; the whole code can be replaced', () => {
    expect(applyEdit(code, { from: 0, to: 0, replace: 'setcpm(30)\n' }).code).toBe(`setcpm(30)\n${code}`);
    expect(applyEdit(code, { from: 0, to: code.length, replace: 's("bd")' }).code).toBe('s("bd")');
  });
  test('rejects non-integers, negative, reversed and past-the-end ranges', () => {
    for (const [from, to] of [[1.5, 3], [0, 2.2], [-1, 2], [5, 4], [0, code.length + 1], [Number.NaN, 2]]) {
      expect(() => applyEdit(code, { from, to, replace: 'x' }), `${from}-${to}`).toThrow(EditError);
    }
    expect(() => applyEdit(code, { from: '1', to: 2, replace: 'x' } as any)).toThrow(/integers/);
    expect(() => applyEdit(code, { from: 1, replace: 'x' })).toThrow(/both from and to/);
  });
  test('must stay inside the selection when one is attached', () => {
    const sel = { from: 0, to: 20 };
    expect(applyEdit(code, { from: 13, to: 18, replace: 'bd bd' }, sel).code).toContain('"bd bd"');
    expect(() => applyEdit(code, { from: 15, to: 25, replace: 'x' }, sel)).toThrow(/outside the selected/);
    expect(() => applyEdit(code, { from: 25, to: 25, replace: 'x' }, sel)).toThrow(/outside the selected/);
  });
  test('find and range are exclusive; one of them is required; replace must be a string', () => {
    expect(() => applyEdit(code, { find: 'hh', from: 0, to: 1, replace: 'x' })).toThrow(/not both/);
    expect(() => applyEdit(code, { replace: 'x' })).toThrow(/find/);
    expect(() => applyEdit(code, { find: 'hh*8' })).toThrow(/replace/);
    expect(applyEdit(code, { find: 'hh*8', replace: 'hh*4' }).code).toContain('hh*4');
  });
});

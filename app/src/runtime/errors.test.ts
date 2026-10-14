import { expect, test } from 'vitest';
import { transpiler } from '@strudel/transpiler';
import { errorLocation, toErrorInfo } from './errors';

test('acorn syntax errors from the transpiler carry line and column', () => {
  let err: unknown;
  try { transpiler('s("bd")\nnote("c e").fast(\n', {}); } catch (e) { err = e; }
  const info = toErrorInfo(err);
  expect(info.line).toBe(3);
  expect(info.col).toBeGreaterThan(0);
  expect(errorLocation('Unexpected token (2:4)')).toEqual({ line: 2, col: 5 });
});

test('mini-notation errors carry the line; plain runtime errors carry nothing', () => {
  let err: unknown;
  try { transpiler('setcpm(30)\ns("bd [sd")', {}); } catch (e) { err = e; }
  expect(toErrorInfo(err).line).toBe(2);
  expect(toErrorInfo(new Error('foo is not defined'))).toEqual({ message: 'foo is not defined' });
});

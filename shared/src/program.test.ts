import { expect, test } from 'vitest';
import { fromProgram, loopProgram, ProgramError, soloProgram } from './program';

const code = 'const a = s("bd")\nconst b = s("hh")\nstack(a, b)';

test('soloProgram appends the selection as the final expression with a guarding semicolon', () => {
  const from = code.indexOf('s("hh")');
  expect(soloProgram(code, { from, to: from + 7 })).toBe(code + '\n;(s("hh"))');
});

test('fromProgram shifts the output to start at a cycle', () => {
  expect(fromProgram(code, 8)).toBe(code + '\n;(stack(a, b)).early(8)');
});

test('loopProgram loops a section with ribbon', () => {
  expect(loopProgram(code, 8, 4)).toBe(code + '\n;(stack(a, b)).ribbon(8, 4)');
});

test('from/loopProgram throw a typed ProgramError when there is no output expression', () => {
  for (const f of [() => fromProgram('const a = s("bd")', 0), () => loopProgram('const a = s("bd")', 0, 4), () => fromProgram('stack(', 0)]) {
    expect(f).toThrow(ProgramError);
    expect(f).toThrow(/no output expression/);
  }
});

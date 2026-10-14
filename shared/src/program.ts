import { lastExpression } from './ast';
import type { Range } from './types';

/** The code has no final expression to play from / loop (e.g. it ends with a declaration). */
export class ProgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgramError';
  }
}

// leading ";" stops a previous line from swallowing the "(" (Strudel ASI gotcha)
export function soloProgram(code: string, sel: Range): string {
  return `${code}\n;(${code.slice(sel.from, sel.to)})`;
}

function output(code: string): string {
  const last = lastExpression(code);
  if (!last) throw new ProgramError('no output expression found: the code must end with the pattern to play');
  return last.text;
}

export function fromProgram(code: string, startCycle: number): string {
  return `${code}\n;(${output(code)}).early(${startCycle})`;
}

export function loopProgram(code: string, startCycle: number, cycles: number): string {
  return `${code}\n;(${output(code)}).ribbon(${startCycle}, ${cycles})`;
}

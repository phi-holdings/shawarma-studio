import type { ErrorInfo } from './protocol';

/**
 * Source location of a Strudel evaluation error, when the error carries one:
 * - acorn syntax errors: `err.loc` ({ line, column 0-based }) and a trailing "(line:column)" in the message;
 * - mini-notation parse errors: "[mini] parse error at line N: …".
 * Runtime errors thrown inside the evaluated function have no usable location (the code is transpiled).
 */
export function errorLocation(message: string, loc?: unknown): { line: number; col?: number } | null {
  if (loc && typeof loc === 'object') {
    const { line, column } = loc as { line?: unknown; column?: unknown };
    if (typeof line === 'number' && line > 0) return { line, ...(typeof column === 'number' ? { col: column + 1 } : {}) };
  }
  const acorn = /\((\d+):(\d+)\)\s*$/.exec(message);
  if (acorn) return { line: Number(acorn[1]), col: Number(acorn[2]) + 1 };
  const mini = /\[mini\] parse error at line (\d+)/.exec(message);
  if (mini) return { line: Number(mini[1]) };
  return null;
}

export function toErrorInfo(e: unknown): ErrorInfo {
  const message = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
  const where = errorLocation(message, (e as { loc?: unknown })?.loc);
  return { message, ...(where ?? {}) };
}

/** Error carrying the runtime's location info across the boundary. */
export class RuntimeError extends Error {
  line?: number; col?: number;
  constructor(info: ErrorInfo) {
    super(info.message);
    this.name = 'RuntimeError';
    this.line = info.line; this.col = info.col;
  }
}

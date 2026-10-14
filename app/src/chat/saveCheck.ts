import { inspectCode } from '../api';

/** A save was held back because the code does not evaluate; `problem` says why. */
export class CheckFailedError extends Error {
  constructor(readonly problem: string) {
    super(problem);
    this.name = 'CheckFailedError';
  }
}

/**
 * Runs the server's check (/api/inspect) on code about to become a version. Returns what is wrong when it
 * does not evaluate, else null. Warnings (an empty section, an unknown sound) never hold a save back, and
 * neither does an unreachable server: the save itself will report that.
 */
export async function checkProblem(code: string): Promise<string | null> {
  try {
    const r = await inspectCode(code);
    if (!r.ok) return `This code doesn't run: ${r.error ?? 'evaluation failed'}`;
    const err = r.issues.find((i) => i.kind === 'eval_error');
    return err ? `This code doesn't run: ${err.message}` : null;
  } catch {
    return null;
  }
}

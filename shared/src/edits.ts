import type { Range } from './types';

export class EditError extends Error {}

export function findUnique(code: string, find: string): Range {
  if (!find) throw new EditError('find text is empty');
  const first = code.indexOf(find);
  if (first < 0) throw new EditError(`find text not found: ${JSON.stringify(find.slice(0, 80))}`);
  let count = 0;
  for (let i = code.indexOf(find); i >= 0; i = code.indexOf(find, i + 1)) count++;
  if (count > 1) throw new EditError(`find text occurs ${count} times; include more surrounding code so it is unique`);
  return { from: first, to: first + find.length };
}

export function applyFindReplace(code: string, find: string, replace: string, within?: Range) {
  const hit = within ? findWithin(code, find, within) : findUnique(code, find);
  const next = code.slice(0, hit.from) + replace + code.slice(hit.to);
  return { code: next, range: { from: hit.from, to: hit.from + replace.length }, delta: replace.length - find.length };
}

/** Find `find` only inside code[within.from, within.to); uniqueness is checked inside the selection only. */
function findWithin(code: string, find: string, within: Range): Range {
  const from = Math.max(0, Math.min(within.from, code.length));
  const to = Math.max(from, Math.min(within.to, code.length));
  const slice = code.slice(from, to);
  if (!find) throw new EditError('find text is empty');
  if (!slice.includes(find)) {
    if (code.includes(find)) throw new EditError('edit is outside the selected range; only change code inside the selection');
    throw new EditError(`find text not found: ${JSON.stringify(find.slice(0, 80))}`);
  }
  let hit: Range;
  try {
    hit = findUnique(slice, find);
  } catch (e) {
    if (e instanceof EditError) throw new EditError(`${e.message} (within the selection)`);
    throw e;
  }
  return { from: hit.from + from, to: hit.to + from };
}

/** Replace code[from, to) (an empty range inserts). Offsets are character (UTF-16) indices into `code`. */
export function applyRangeEdit(code: string, from: number, to: number, replace: string, within?: Range) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new EditError('from and to must be integers (character offsets)');
  if (from < 0 || from > to || to > code.length) throw new EditError(`range ${from}-${to} is invalid: need 0 <= from <= to <= ${code.length} (the code length)`);
  if (within && (from < within.from || to > within.to)) {
    throw new EditError(`range ${from}-${to} is outside the selected range ${within.from}-${within.to}; only change code inside the selection`);
  }
  const next = code.slice(0, from) + replace + code.slice(to);
  return { code: next, range: { from, to: from + replace.length }, delta: replace.length - (to - from) };
}

/** An edit is either an exact unique `find` text or a `{from, to}` character range, plus the replacement. */
export interface EditSpec { find?: unknown; from?: unknown; to?: unknown; replace?: unknown }

/** Validate and apply one edit (find/replace or range); throws EditError with a message meant for the model. */
export function applyEdit(code: string, spec: EditSpec, within?: Range) {
  const { find, from, to, replace } = spec ?? {};
  if (typeof replace !== 'string') throw new EditError('replace must be a string');
  const hasRange = from !== undefined || to !== undefined;
  if (find !== undefined && hasRange) throw new EditError('give either find or from/to, not both');
  if (hasRange) {
    if (typeof from !== 'number' || typeof to !== 'number') throw new EditError('a range edit needs both from and to as integers');
    return applyRangeEdit(code, from, to, replace, within);
  }
  if (typeof find !== 'string') throw new EditError('give find (exact text) or a from/to character range');
  return applyFindReplace(code, find, replace, within);
}

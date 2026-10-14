/**
 * Maps positions in an evaluated program back to the editor document.
 *
 * Derived programs (run selection, play from / loop a section) are the document followed by
 * "\n;(" + a copy of part of the document + ")…". Positions in the document prefix map to
 * themselves; positions inside the copy map to the copied source; anything else (glue code) is null.
 */
export type PosMap = (pos: number) => number | null;

export interface CopyOrigin { from: number; to: number }

export function buildPosMap(evaluated: string, doc: string, origin?: CopyOrigin): PosMap {
  if (!evaluated.startsWith(doc)) return () => null;
  const base = doc.length;
  if (evaluated.length === base) return (p) => (p >= 0 && p <= base ? p : null);
  const copyAt = base + 3; // "\n;("
  let src = origin && doc.slice(origin.from, origin.to) === evaluated.slice(copyAt, copyAt + origin.to - origin.from) ? origin : findCopy(evaluated, doc, copyAt);
  return (p) => {
    if (p >= 0 && p <= base) return p;
    if (src && p >= copyAt && p <= copyAt + (src.to - src.from)) return src.from + (p - copyAt);
    return null;
  };
}

/** Longest prefix of evaluated[copyAt…] that occurs in the document (first occurrence). */
function findCopy(evaluated: string, doc: string, copyAt: number): CopyOrigin | undefined {
  if (evaluated.slice(doc.length, copyAt) !== '\n;(') return undefined;
  let lo = 0, hi = Math.min(doc.length, evaluated.length - copyAt);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.includes(evaluated.slice(copyAt, copyAt + mid))) lo = mid; else hi = mid - 1;
  }
  if (lo === 0) return undefined;
  const from = doc.indexOf(evaluated.slice(copyAt, copyAt + lo));
  return { from, to: from + lo };
}

/** Maps a [from, to] range; null unless both ends land in the same mapped region. */
export function mapRange(map: PosMap, from: number, to: number): [number, number] | null {
  const a = map(from), b = map(to);
  if (a === null || b === null || b < a || b - a !== to - from) return null;
  return [a, b];
}

// Rows for showing one hunk of a proposal: 2 lines of context, the lines it replaces and Claude's lines,
// with the changed words marked inside them, and line numbers of the current buffer.
import { contextAround, wordDiff, type MergeHunk } from '@shawarma/shared';

export type Seg = { text: string; hl: boolean };
export type Row = { kind: 'ctx' | 'del' | 'add'; n: number | null; segs: Seg[] };

/** Splits highlighted segments into lines (a final newline does not start an extra line). */
export function segLines(segs: Seg[]): Seg[][] {
  const lines: Seg[][] = [[]];
  for (const s of segs) {
    const parts = s.text.split('\n');
    parts.forEach((t, i) => {
      if (i > 0) lines.push([]);
      if (t) lines[lines.length - 1].push({ text: t, hl: s.hl });
    });
  }
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

/** Word marks only help when most of the text is shared; a rewrite reads better without them. */
const MAX_CHANGED_SHARE = 0.6;

export function hunkRows(current: string, h: MergeHunk, context = 2): Row[] {
  const { before, after } = contextAround(current, h.offset, h.offset + h.current.length, context);
  let oldSegs: Seg[] = [{ text: h.current, hl: false }];
  let newSegs: Seg[] = [{ text: h.proposed, hl: false }];
  if (h.current && h.proposed) {
    const parts = wordDiff(h.current, h.proposed);
    const changed = parts.filter((p) => p.kind !== 'same').reduce((n, p) => n + p.text.trim().length, 0);
    const total = (h.current + h.proposed).replace(/\s+/g, '').length || 1;
    if (changed / total <= MAX_CHANGED_SHARE) {
      oldSegs = parts.filter((p) => p.kind !== 'add').map((p) => ({ text: p.text, hl: p.kind === 'del' }));
      newSegs = parts.filter((p) => p.kind !== 'del').map((p) => ({ text: p.text, hl: p.kind === 'add' }));
    }
  }
  const dels = h.current ? segLines(oldSegs) : [];
  const adds = h.proposed ? segLines(newSegs) : [];
  return [
    ...before.map((t, i): Row => ({ kind: 'ctx', n: h.line - before.length + i, segs: [{ text: t, hl: false }] })),
    ...dels.map((segs, i): Row => ({ kind: 'del', n: h.line + i, segs })),
    ...adds.map((segs): Row => ({ kind: 'add', n: null, segs })),
    ...after.map((t, i): Row => ({ kind: 'ctx', n: h.line + dels.length + i, segs: [{ text: t, hl: false }] })),
  ];
}

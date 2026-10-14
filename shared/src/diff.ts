import { diffLines, diffWordsWithSpace } from 'diff';
import { arrangeInfo, arrangeLayout, type ArrangeLayout } from './ast';
import type { Range } from './types';

export type Hunk = { id: number; kind: 'same' | 'change'; removed: string; added: string };

export function hunks(before: string, after: string): Hunk[] {
  const out: Hunk[] = [];
  for (const part of diffLines(before, after)) {
    const last = out[out.length - 1];
    if (!part.added && !part.removed) {
      out.push({ id: out.length, kind: 'same', removed: part.value, added: part.value });
    } else if (last && last.kind === 'change') {
      if (part.removed) last.removed += part.value; else last.added += part.value;
    } else {
      out.push({ id: out.length, kind: 'change', removed: part.removed ? part.value : '', added: part.added ? part.value : '' });
    }
  }
  return out;
}

export function mergeHunks(list: Hunk[], accepted: Set<number>): string {
  return list.map((h) => (h.kind === 'same' ? h.added : accepted.has(h.id) ? h.added : h.removed)).join('');
}

// ---- review helpers (chat cards) -------------------------------------------------------------------

export type WordPart = { text: string; kind: 'same' | 'del' | 'add' };

/** Word-level difference between two texts (whitespace kept), for highlighting inside changed lines. */
export function wordDiff(before: string, after: string): WordPart[] {
  return diffWordsWithSpace(before, after).map((p) => ({ text: p.value, kind: p.added ? 'add' : p.removed ? 'del' : 'same' }));
}

/** 1-based line number of a character offset. */
export function lineAt(code: string, pos: number): number {
  let n = 1;
  const end = Math.min(pos, code.length);
  for (let i = 0; i < end; i++) if (code.charCodeAt(i) === 10) n++;
  return n;
}

/** Up to `n` whole lines of `code` before / after the character range [from, to) (from and to at line starts). */
export function contextAround(code: string, from: number, to: number, n = 2): { before: string[]; after: string[] } {
  const head = code.slice(0, from).split('\n');
  head.pop();   // the (partial) line the range starts on: empty when the range starts a line
  const tail = code.slice(to).split('\n');
  if (tail[tail.length - 1] === '') tail.pop();
  return { before: head.slice(-n), after: tail.slice(0, n) };
}

/**
 * The song section a character offset belongs to, from the arrange() layout: the code from a section's
 * header comment or pattern definition up to the next one, or the section's entry inside arrange().
 * Null for code before any section, or when the song has no readable arrange().
 */
export function sectionAt(code: string, pos: number): string | null {
  let layout: ArrangeLayout | null;
  let labels: string[] | null;
  try { layout = arrangeLayout(code); labels = arrangeInfo(code).labels; } catch { return null; }
  if (!layout || !labels) return null;
  const entry = layout.entries.findIndex((e) => pos >= e.from && pos <= e.to);
  if (entry >= 0) return labels[entry] ?? null;
  if (pos >= layout.call) return null;
  const { headers, defs } = layout;
  const anchors = labels
    .map((label, i) => ({ label, at: Math.min(headers[i] ?? Infinity, defs[i] ?? Infinity) }))
    .filter((a) => Number.isFinite(a.at))
    .sort((a, b) => a.at - b.at);
  let found: string | null = null;
  for (const a of anchors) if (a.at <= pos) found = a.label;
  return found;
}

/** "Lines 3–7 · Drums" for a character range of `code` (with the section only when the range sits in one). */
export function scopeLabel(code: string, range: Range): string {
  const endPos = range.to > range.from && code[range.to - 1] === '\n' ? range.to - 1 : range.to;
  const a = lineAt(code, range.from);
  const b = lineAt(code, endPos);
  const lines = a === b ? `Line ${a}` : `Lines ${a}–${b}`;
  const s1 = sectionAt(code, range.from);
  const s2 = sectionAt(code, Math.max(range.from, endPos - 1));
  return s1 && s1 === s2 ? `${lines} · ${s1}` : lines;
}

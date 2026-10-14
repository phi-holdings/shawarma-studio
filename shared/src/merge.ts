// Three-way, line-based merge used to rebase Claude's proposal onto the editor buffer as it is now.
//
//   base     the buffer when the request was sent (the proposal's baseCode)
//   proposal Claude's version of base
//   current  the editor buffer now (base plus whatever the user typed since)
//
// Every change Claude made becomes a hunk against `current`. A hunk is "clean" when the user did not
// touch those lines, and a "conflict" when both sides changed the same lines differently. Conflicts never
// block the rest: by default they keep the user's text, and each one can be switched to Claude's text.
import { diffArrays } from 'diff';

export interface MergeHunk {
  id: number;
  kind: 'clean' | 'conflict';
  /** The lines as they are in `current` (what the hunk replaces). */
  current: string;
  /** Claude's lines for the same place. */
  proposed: string;
  /** The lines in `base`, before either side changed them. */
  base: string;
  /** 1-based line in `current` where the hunk starts (for an insertion: the line it goes before). */
  line: number;
  /** Character offset in `current` where the hunk starts. */
  offset: number;
}

type Segment = { text: string } | { hunk: number };

export interface MergeResult {
  hunks: MergeHunk[];
  /** `current` cut into unchanged text and hunk slots, in order (see applyMerge). */
  segments: Segment[];
  /** True when nothing the user typed since the request overlaps Claude's changes. */
  clean: boolean;
}

/** Lines with their line endings ("a\nb" → ["a\n", "b"]). */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

interface Edit { start: number; end: number; lines: string[]; side: 'ours' | 'theirs' }

/** The edits that turn `base` into `other`, as base line ranges [start, end) and their replacement lines. */
function editsOf(base: string[], other: string[], side: Edit['side']): Edit[] {
  const out: Edit[] = [];
  let i = 0;
  let open: Edit | null = null;
  for (const part of diffArrays(base, other)) {
    const n = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      if (open) { out.push(open); open = null; }
      i += n;
      continue;
    }
    open ??= { start: i, end: i, lines: [], side };
    if (part.removed) { open.end += n; i += n; } else open.lines.push(...part.value);
  }
  if (open) out.push(open);
  return out;
}

/** Edits touch when their base ranges overlap, start at the same line, or one inserts inside the other. */
function touches(a: Edit, b: Edit): boolean {
  if (a.start === b.start) return true;
  if (a.start < b.end && b.start < a.end) return true;
  const inside = (ins: Edit, r: Edit) => ins.start === ins.end && ins.start > r.start && ins.start < r.end;
  return inside(a, b) || inside(b, a);
}

/** One side's text for base lines [from, to), with that side's edits in the range applied. */
function sideText(base: string[], from: number, to: number, edits: Edit[]): string {
  let out = '';
  let p = from;
  for (const e of edits) {
    out += base.slice(p, e.start).join('') + e.lines.join('');
    p = e.end;
  }
  return out + base.slice(p, to).join('');
}

export function merge3(base: string, proposal: string, current: string): MergeResult {
  const b = splitLines(base);
  const theirs = editsOf(b, splitLines(proposal), 'theirs');
  const ours = editsOf(b, splitLines(current), 'ours');
  const all = [...theirs, ...ours].sort((x, y) => x.start - y.start || x.end - y.end);

  // group edits that touch (transitively); each group is one region of base
  const groups: { start: number; end: number; edits: Edit[] }[] = [];
  for (const e of all) {
    const g = groups[groups.length - 1];
    if (g && (e.start < g.end || g.edits.some((x) => touches(x, e)))) {
      g.edits.push(e);
      g.end = Math.max(g.end, e.end);
    } else {
      groups.push({ start: e.start, end: e.end, edits: [e] });
    }
  }

  const segments: Segment[] = [];
  const hunks: MergeHunk[] = [];
  let text = '';   // `current` emitted so far, for line numbers and offsets
  let p = 0;
  const emit = (t: string) => { if (t) { segments.push({ text: t }); text += t; } };
  for (const g of groups) {
    emit(b.slice(p, g.start).join(''));
    p = g.end;
    const mine = g.edits.filter((e) => e.side === 'ours');
    const claude = g.edits.filter((e) => e.side === 'theirs');
    const baseText = b.slice(g.start, g.end).join('');
    const oursText = sideText(b, g.start, g.end, mine);
    const theirsText = sideText(b, g.start, g.end, claude);
    if (claude.length === 0 || oursText === theirsText) { emit(oursText); continue; }   // only the user's edit, or the same edit on both sides
    const kind = mine.length === 0 ? 'clean' : 'conflict';
    const line = text.split('\n').length;   // text is whole lines here, so this is the next line's number
    hunks.push({ id: hunks.length, kind, current: oursText, proposed: theirsText, base: baseText, line, offset: text.length });
    segments.push({ hunk: hunks.length - 1 });
    text += oursText;
  }
  emit(b.slice(p).join(''));
  return { hunks, segments, clean: hunks.every((h) => h.kind === 'clean') };
}

/** Ids of the hunks taken by default: every clean one; conflicts keep the user's text. */
export function defaultChoice(r: MergeResult): Set<number> {
  return new Set(r.hunks.filter((h) => h.kind === 'clean').map((h) => h.id));
}

/** `current` with Claude's text for the hunks in `take` (default: defaultChoice). */
export function applyMerge(r: MergeResult, take: Set<number> = defaultChoice(r)): string {
  return r.segments.map((s) => ('text' in s ? s.text : take.has(s.hunk) ? r.hunks[s.hunk].proposed : r.hunks[s.hunk].current)).join('');
}

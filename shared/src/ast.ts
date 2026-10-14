import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { Range } from './types';

type Node = acorn.Node & { [k: string]: any };

export function parseProgram(code: string, onComment?: acorn.Comment[]): acorn.Program | null {
  try {
    return acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      onComment,
    });
  } catch {
    return null;
  }
}

const EXPRESSION = /Expression$|^Identifier$|^Literal$|^TemplateLiteral$/;

export function snapToExpression(code: string, sel: Range): (Range & { text: string }) | null {
  const ast = parseProgram(code);
  if (!ast) return null;
  let best: Node | null = null;
  walk.full(ast, (n: Node) => {
    if (!EXPRESSION.test(n.type)) return;
    if (n.start <= sel.from && n.end >= sel.to) {
      if (!best || n.end - n.start < best.end - best.start) best = n;
    }
  });
  if (!best) return null;
  const b = best as Node;
  // a bare identifier inside a call (e.g. "pads" of pads('minor')) → take the call
  let pick: Node = b;
  walk.full(ast, (n: Node) => {
    if (pick !== b) return;
    if (n.type === 'CallExpression' && (n.callee === b || ((b.type === 'Literal' || b.type === 'TemplateLiteral') && n.arguments.includes(b)))) pick = n;
    if (n.type === 'MemberExpression' && n.property === b) pick = n;
  });
  return { from: pick.start, to: pick.end, text: code.slice(pick.start, pick.end) };
}

export function lastExpression(code: string): (Range & { text: string }) | null {
  const ast = parseProgram(code);
  if (!ast) return null;
  for (let i = ast.body.length - 1; i >= 0; i--) {
    const st = ast.body[i] as Node;
    if (st.type === 'ExpressionStatement') {
      const e = st.expression as Node;
      return { from: e.start, to: e.end, text: code.slice(e.start, e.end) };
    }
  }
  return null;
}

/**
 * Top-level arrange() calls in source order: calls nested inside another arrange() call (a section
 * that is itself an arrangement) are part of that arrangement and not counted.
 */
function arrangeCalls(ast: acorn.Program): Node[] {
  const calls: Node[] = [];
  walk.full(ast, (n: Node) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'arrange') calls.push(n);
  });
  return calls
    .filter((c) => !calls.some((o) => o !== c && o.start <= c.start && c.end <= o.end))
    .sort((a, b) => a.start - b.start);
}

/**
 * Section labels of the last top-level arrange() call plus how many top-level arrange() calls there are
 * (more than one: the evaluated song uses the last one, which the caller should report).
 * A section's label is the line comment that follows it on the same line (a comment after several
 * sections on one line belongs to the nearest section before it only), else its pattern source.
 * labels is null without arrange(), with unparseable code, or when a non-array (e.g. spread) argument
 * hides the section count.
 */
export function arrangeInfo(code: string): { labels: string[] | null; calls: number } {
  const comments: acorn.Comment[] = [];
  const ast = parseProgram(code, comments);
  if (!ast) return { labels: null, calls: 0 };
  const calls = arrangeCalls(ast);
  if (calls.length === 0) return { labels: null, calls: 0 };
  const call = calls[calls.length - 1];
  const args = call.arguments as Node[];
  if (args.some((a) => !a || a.type !== 'ArrayExpression' || a.elements.length < 2)) return { labels: null, calls: calls.length };
  const lineOf = (pos: number) => code.slice(0, pos).split('\n').length;
  const fromComment = new Map<Node, string>();
  for (const k of comments) {
    if (k.type !== 'Line' || k.start < args[0].end) continue;
    // the nearest section ending before the comment, and only if it ends on the comment's line
    let owner: Node | null = null;
    for (const a of args) if (a.end <= k.start && (!owner || a.end > owner.end)) owner = a;
    if (owner && lineOf(owner.end) === lineOf(k.start) && !fromComment.has(owner)) fromComment.set(owner, k.value.trim());
  }
  const labels = args.map((a, i) => {
    const c = fromComment.get(a);
    if (c) return c;
    const pat = a.elements[1] as Node | null; // holey arrays ([8, , x]) have null elements
    return pat ? code.slice(pat.start, pat.end).replace(/\s+/g, ' ').slice(0, 32) : `Section ${i + 1}`;
  });
  return { labels, calls: calls.length };
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A header comment names a section when its words equal the label's, or one starts with the other. */
function headerMatch(header: string, label: string): 0 | 1 | 2 {
  if (!header || !label) return 0;
  if (header === label) return 2;
  return header.startsWith(`${label} `) || label.startsWith(`${header} `) ? 1 : 0;
}

export interface ArrangeLayout {
  /** Start of the last top-level arrange() call. */
  call: number;
  /** Start of the top-level `const|let|var NAME =` declaration of each section whose pattern is a plain name. */
  defs: (number | null)[];
  /** Each section's `[cycles, pattern]` entry, in order. */
  entries: Range[];
  /**
   * Start of each section's header comment (a whole-line `//` comment outside the arrange() call whose
   * words match the section's label, e.g. `// ==== HYMN I: CHOIR ====` for "Hymn I: choir"), or null.
   */
  headers: (number | null)[];
}

/**
 * Where the sections of the last top-level arrange() call are written, for editor decorations.
 * Null when arrangeInfo() has no labels (no arrange(), unparseable code, non-array arguments).
 */
export function arrangeLayout(code: string): ArrangeLayout | null {
  const { labels } = arrangeInfo(code);
  if (!labels) return null;
  const comments: acorn.Comment[] = [];
  const ast = parseProgram(code, comments)!;
  const calls = arrangeCalls(ast);
  const call = calls[calls.length - 1];
  const args = call.arguments as Node[];
  const lineStart = (pos: number) => code.lastIndexOf('\n', pos - 1) + 1;
  const headers = comments
    .filter((k) => k.type === 'Line' && (k.end <= call.start || k.start >= call.end) && code.slice(lineStart(k.start), k.start).trim() === '')
    .map((k) => ({ at: k.start, text: words(k.value) }))
    .filter((h) => h.text);
  const used = new Set<number>();
  const found = labels.map((label, i) => {
    // a label taken from the pattern source only names a header when it is a plain identifier (e.g. `verse`)
    const pat = args[i].elements[1] as Node | null;
    const fromSource = pat && label === code.slice(pat.start, pat.end).replace(/\s+/g, ' ').slice(0, 32);
    if (fromSource && pat.type !== 'Identifier') return null;
    if (/^Section \d+$/.test(label) && !fromSource) return null;
    const l = words(label);
    let best: { at: number; score: number } | null = null;
    for (const h of headers) {
      if (used.has(h.at)) continue;
      const score = headerMatch(h.text, l);
      if (score > (best?.score ?? 0)) best = { at: h.at, score };
      if (score === 2) break;
    }
    if (best) used.add(best.at);
    return best?.at ?? null;
  });
  // where each section's pattern is defined (`const hymnChoir = ...`), for patterns named by an identifier
  const declOf = new Map<string, number>();
  for (const st of ast.body as Node[]) {
    if (st.type !== 'VariableDeclaration') continue;
    for (const d of st.declarations as Node[]) if (d.id?.type === 'Identifier' && !declOf.has(d.id.name)) declOf.set(d.id.name, st.start);
  }
  const defs = args.map((a) => {
    const pat = a.elements?.[1] as Node | null;
    return pat?.type === 'Identifier' ? declOf.get(pat.name) ?? null : null;
  });
  // no label match: fall back to the nearest banner comment (// ==== X ====) above the definition, once per banner
  const banners = comments
    .filter((k) => k.type === 'Line' && /[=\-#*~]{4,}/.test(k.value) && words(k.value) && k.end <= call.start
      && code.slice(lineStart(k.start), k.start).trim() === '')
    .map((k) => k.start);
  found.forEach((h, i) => {
    const def = defs[i];
    if (h !== null || def === null) return;
    const above = banners.filter((b) => b < def && !used.has(b));
    const near = above[above.length - 1];
    if (near === undefined) return;
    // only if no other section's definition sits between the banner and this one
    if (defs.some((d, j) => j !== i && d !== null && d > near && d < def)) return;
    used.add(near);
    found[i] = near;
  });
  return { call: call.start, defs, entries: args.map((a) => ({ from: a.start, to: a.end })), headers: found };
}

export function arrangeLabels(code: string): string[] | null {
  return arrangeInfo(code).labels;
}

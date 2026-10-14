// One-click visuals: add or remove an inline visual (`._pianoroll()` & co., drawn by the runtime, see
// runtime/visuals.ts) at the end of a layer's method chain.
import { lastExpression, parseProgram, type Range } from '@shawarma/shared';

export const VISUALS = [
  { fn: '_pianoroll', label: 'Piano roll' },
  { fn: '_punchcard', label: 'Punchcard' },
  { fn: '_scope', label: 'Scope' },
  { fn: '_spectrum', label: 'Spectrum' },
  { fn: '_pitchwheel', label: 'Pitch wheel' },
] as const;
export type VisualFn = (typeof VISUALS)[number]['fn'];

interface N { type: string; start: number; end: number; [k: string]: unknown }
const isNode = (x: unknown): x is N => typeof x === 'object' && x !== null && typeof (x as N).type === 'string';

/** Calls whose arguments are layers of their own: a visual goes on the layer, not on the whole stack. */
const LAYER_FNS = new Set(['stack', 'cat', 'seq', 'sequence', 'fastcat', 'slowcat', 'arrange', 'polymeter', 'timeCat', 'timecat', 'chooseCycles', 'randcat', 'wchooseCycles']);
/** Calls that are settings, not patterns. */
const NOT_PATTERNS = new Set(['setcpm', 'setCpm', 'setcps', 'setCps', 'samples', 'hush', 'await']);
const EXPR = /Expression$|^Identifier$|^Literal$|^TemplateLiteral$/;

const calleeName = (call: N): string | null => {
  const c = call.callee as N;
  if (c?.type === 'Identifier') return c.name as string;
  if (c?.type === 'MemberExpression' && (c.property as N)?.type === 'Identifier') return (c.property as N).name as string;
  return null;
};

/** Smallest expression covering [from, to], with its ancestors (outermost first). */
function findPath(root: N, from: number, to: number): N[] {
  let best: N[] = [];
  const visit = (n: N, path: N[]) => {
    if (n.start > from || n.end < to) return;
    const here = [...path, n];
    if (EXPR.test(n.type)) best = here;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => isNode(c) && visit(c, here));
      else if (isNode(v)) visit(v, here);
    }
  };
  visit(root, []);
  return best;
}

/**
 * The layer a visual applies to: from the selection (or cursor), up through the call it is an argument
 * of (s("bd") from inside "bd"), then to the end of its method chain; never past a stack()/arrange()
 * argument. No selection inside a pattern: the last expression of the program.
 */
export function targetLayer(code: string, sel: Range): Range | null {
  const ast = parseProgram(code) as unknown as N | null;
  if (!ast) return null;
  const path = findPath(ast, sel.from, sel.to);
  let i = path.length - 1;
  if (i >= 0) {
    for (;;) {
      const n = path[i], p = path[i - 1], g = path[i - 2];
      if (p?.type === 'MemberExpression') { i -= g?.type === 'CallExpression' && g.callee === p ? 2 : 1; continue; }
      if (p?.type === 'CallExpression' && p.callee === n) { i -= 1; continue; }
      if (p?.type === 'CallExpression' && (p.arguments as N[]).includes(n) && !LAYER_FNS.has(calleeName(p) ?? '')) { i -= 1; continue; }
      break;
    }
    const n = path[i];
    const isPattern = !(n.type === 'CallExpression' && NOT_PATTERNS.has(calleeName(n) ?? '')) && n.type !== 'AssignmentExpression' && n.type !== 'ArrowFunctionExpression' && n.type !== 'FunctionExpression';
    if (isPattern) return { from: n.start, to: n.end };
  }
  const last = lastExpression(code);
  return last ? { from: last.from, to: last.to } : null;
}

/** The `.fn(...)` call in the chain ending at `layer`, if any. */
function findInChain(code: string, layer: Range, fn: string): { from: number; to: number } | null {
  const ast = parseProgram(code) as unknown as N | null;
  if (!ast) return null;
  const path = findPath(ast, layer.from, layer.to);
  let c: N | undefined = path[path.length - 1];
  while (c && c.type === 'CallExpression' && (c.callee as N).type === 'MemberExpression') {
    const callee = c.callee as N;
    const prop = callee.property as N;
    if (prop.type === 'Identifier' && prop.name === fn) return { from: (callee.object as N).end, to: c.end };
    c = callee.object as N;
  }
  return null;
}

/** Which visuals the targeted layer already has. */
export function activeVisuals(code: string, sel: Range): Set<VisualFn> {
  const layer = targetLayer(code, sel);
  return new Set(layer ? VISUALS.map((v) => v.fn).filter((fn) => findInChain(code, layer, fn)) : []);
}

/** The edit that adds `.fn()` to the targeted layer, or removes it when it is there. */
export function toggleVisual(code: string, sel: Range, fn: VisualFn): { from: number; to: number; insert: string; added: boolean } | null {
  const layer = targetLayer(code, sel);
  if (!layer) return null;
  const existing = findInChain(code, layer, fn);
  if (existing) return { ...existing, insert: '', added: false };
  return { from: layer.to, to: layer.to, insert: `.${fn}()`, added: true };
}

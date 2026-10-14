// Spin guards for song code that runs in the browser (see app/src/runtime/engine.ts and guardRealm.ts).
//
// A song is JavaScript; code that never yields (`while (true) {}` at the top level, in a pattern
// callback, in a function called every cycle, or an endless chain of awaits) would keep the song
// runtime's thread busy forever. guardLoops() rewrites the song so that
//  - every while / do / for / for-in / for-of loop gets, per entry, a checker from `guard()` that is
//    called on every iteration and throws once the loop has run longer than its budget;
//  - every `await x` becomes `await guard.a(x)`, which counts microtasks (see createLoopGuard).
// Insertions only: no node is removed, labels keep working (a labelled loop is wrapped together with
// its labels), and code without loops or awaits is untouched.
import { parse } from 'acorn';
import { ancestor } from 'acorn-walk';

type Node = { type: string; start: number; end: number; body?: Node; argument?: Node };
interface Insert { pos: number; text: string; close: boolean; depth: number }

const LOOPS = ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'];

/** `code` with every loop and await guarded by `guardName` (a global the runtime defines). Throws on syntax errors. */
export function guardLoops(code: string, guardName: string): string {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  const inserts: Insert[] = [];
  let k = 0;
  const loop = (node: Node, ancestors: Node[]) => {
    const depth = ancestors.length;
    const v = `${guardName}_${k++}`;
    // wrap the loop, or the labelled statement(s) around it, in a block that creates its checker
    let target: Node = node;
    for (let i = ancestors.length - 2; i >= 0 && ancestors[i].type === 'LabeledStatement' && ancestors[i].body === target; i--) target = ancestors[i];
    inserts.push({ pos: target.start, text: `{const ${v}=${guardName}();`, close: false, depth });
    inserts.push({ pos: target.end, text: '}', close: true, depth });
    // and check on every iteration, first thing in the body
    const body = node.body!;
    if (body.type === 'BlockStatement') {
      inserts.push({ pos: body.start + 1, text: `${v}();`, close: false, depth: depth + 0.5 });
    } else {
      inserts.push({ pos: body.start, text: `{${v}();`, close: false, depth: depth + 0.5 });
      inserts.push({ pos: body.end, text: '}', close: true, depth: depth + 0.5 });
    }
  };
  const awaited = (node: Node, ancestors: Node[]) => {
    const arg = node.argument!;
    inserts.push({ pos: arg.start, text: `${guardName}.a(`, close: false, depth: ancestors.length });
    inserts.push({ pos: arg.end, text: ')', close: true, depth: ancestors.length });
  };
  const visitors: Record<string, (n: Node, a: Node[]) => void> = Object.fromEntries(LOOPS.map((t) => [t, loop]));
  visitors.AwaitExpression = awaited;
  ancestor(ast as never, visitors as never);
  if (!inserts.length) return code;
  // at one position: closings before openings; closings innermost first, openings outermost first
  inserts.sort((a, b) => a.pos - b.pos || (a.close === b.close ? (a.close ? b.depth - a.depth : a.depth - b.depth) : a.close ? -1 : 1));
  let out = '';
  let at = 0;
  for (const ins of inserts) { out += code.slice(at, ins.pos) + ins.text; at = ins.pos; }
  return out + code.slice(at);
}

/**
 * Source of a function built at runtime (`Function`, `AsyncFunction`, `GeneratorFunction`, …),
 * guarded: the constructor's parameters and body as a function expression of the given kind.
 */
export function guardFunctionSource(kind: '' | 'async ', generator: boolean, params: string[], body: string, guardName: string): string {
  const src = `(${kind}function${generator ? '*' : ''} anonymous(${params.join(',')}\n) {\n${body}\n})`;
  return guardLoops(src, guardName);
}

export class LoopGuardError extends Error {}

export interface LoopGuard {
  /** A checker for one entry of one loop. */
  (): () => void;
  /** Wraps the value of an `await` in song code (counts a microtask). */
  a<T>(value: T): T;
  /** Counts a microtask callback (promise reaction, queueMicrotask). */
  microtask(): void;
}

/**
 * The global guard. A loop checker throws a LoopGuardError (and calls onTrip) once its loop has run
 * for more than `budgetMs`. Microtasks are counted until the next macrotask; past `maxMicrotasks` in
 * a row (an endless promise/await chain never lets a macrotask run) the next one throws.
 */
export function createLoopGuard(opts: {
  budgetMs: number;
  maxMicrotasks?: number;
  now?: () => number;
  onTrip?: (e: LoopGuardError) => void;
  /** Runs `fn` in a later macrotask (default setTimeout 0). */
  later?: (fn: () => void) => void;
}): LoopGuard {
  // the realm's own functions, taken before song code (or guardRealm) could replace them
  const now = opts.now ?? performance.now.bind(performance);
  const timeout = setTimeout;
  const later = opts.later ?? ((fn: () => void) => { timeout(fn, 0); });
  const qm = queueMicrotask;
  const budget = opts.budgetMs;
  const maxMicrotasks = opts.maxMicrotasks ?? 100_000;
  const onTrip = opts.onTrip;
  // after a trip every loop throws at once until the current synchronous run is over, so song code
  // that catches the error inside an outer loop cannot keep the thread busy
  let tripped = false;
  const trip = (message: string) => {
    const e = new LoopGuardError(message);
    if (!tripped) { tripped = true; qm(() => { tripped = false; }); onTrip?.(e); }
    throw e;
  };
  let microtasks = 0;
  const microtask = () => {
    if (microtasks++ === 0) later(() => { microtasks = 0; });
    if (microtasks > maxMicrotasks) {
      microtasks = 0;
      trip(`The song queued more than ${maxMicrotasks} promise callbacks without pausing (an endless await/promise chain?) and was stopped.`);
    }
  };
  const guard = function guard() {
    const start = now();
    let n = 0;
    return function check() {
      if (tripped) trip(`A loop in the song ran for more than ${budget} ms and was stopped (an endless loop?).`);
      if ((++n & 63) !== 0) return;
      if (now() - start > budget) trip(`A loop in the song ran for more than ${budget} ms and was stopped (an endless loop?).`);
    };
  } as LoopGuard;
  guard.a = <T,>(value: T) => { microtask(); return value; };
  guard.microtask = microtask;
  return Object.freeze(guard);
}

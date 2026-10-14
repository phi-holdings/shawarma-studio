// Closes the ways song code could run code the loop guards never saw (see shared/src/loopGuard.ts):
// in the song runtime's realm, eval, the Function constructors (plain, async, generator, async
// generator, also as `.constructor` of any function), and string handlers of setTimeout/setInterval
// all guard the code before running it; promise reactions and queueMicrotask callbacks count toward
// the microtask limit. Everything is replaced with non-writable, non-configurable properties before
// any song code runs, so a song cannot put the originals back.
import { guardFunctionSource, guardLoops, type LoopGuard } from '@shawarma/shared';

type Ctor = (...args: string[]) => unknown;

const lock = (target: object, key: PropertyKey, value: unknown) =>
  Object.defineProperty(target, key, { value, writable: false, configurable: false, enumerable: false });

export function installRealmGuards(guardName: string, guard: LoopGuard, g: typeof globalThis = globalThis) {
  const OrigFunction = g.Function;
  const origEval = g.eval;

  // eval(string): guarded, then evaluated in the global scope (as an indirect eval)
  const guardedEval = function (src: unknown) {
    return typeof src === 'string' ? origEval(guardLoops(src, guardName)) : src;
  };
  Object.defineProperty(guardedEval, 'name', { value: 'eval' });
  lock(g, 'eval', guardedEval);

  // Function(...params, body) and its async / generator variants
  // (the variants are taken from functions created in the target realm itself)
  const ctorOf = (src: string) => Object.getPrototypeOf(new OrigFunction(`return ${src}`)()).constructor as Ctor;
  const kinds: [Ctor, '' | 'async ', boolean][] = [
    [OrigFunction as unknown as Ctor, '', false],
    [ctorOf('async function () {}'), 'async ', false],
    [ctorOf('function* () {}'), '', true],
    [ctorOf('async function* () {}'), 'async ', true],
  ];
  for (const [Orig, kind, generator] of kinds) {
    const Guarded = function (...args: unknown[]) {
      const body = args.length ? String(args.pop()) : '';
      const source = guardFunctionSource(kind, generator, args.map(String), body, guardName);
      return new OrigFunction(`return ${source}`)();
    };
    Object.defineProperty(Guarded, 'name', { value: (Orig as { name: string }).name });
    Guarded.prototype = Orig.prototype;
    lock(Orig.prototype, 'constructor', Guarded);
    if (Orig === (OrigFunction as unknown)) lock(g, 'Function', Guarded);
  }

  // setTimeout / setInterval with a string: guarded like eval
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const orig = g[name].bind(g) as (h: unknown, ms?: number, ...a: unknown[]) => number;
    lock(g, name, (handler: unknown, ms?: number, ...rest: unknown[]) =>
      orig(typeof handler === 'string' ? () => guardedEval(handler) : handler, ms, ...rest));
  }

  // microtasks: each promise reaction / queued microtask counts (an endless chain trips the guard)
  const count = (fn: unknown) => (typeof fn === 'function'
    ? function (this: unknown, ...a: unknown[]) { guard.microtask(); return (fn as (...x: unknown[]) => unknown).apply(this, a); }
    : fn);
  const then = g.Promise.prototype.then;
  lock(g.Promise.prototype, 'then', function (this: Promise<unknown>, onFulfilled?: unknown, onRejected?: unknown) {
    return then.call(this, count(onFulfilled) as never, count(onRejected) as never);
  });
  const qm = g.queueMicrotask.bind(g);
  lock(g, 'queueMicrotask', (fn: () => void) => qm(count(fn) as () => void));
}

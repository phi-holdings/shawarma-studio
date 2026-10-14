import { expect, test } from 'vitest';
import { createLoopGuard, guardFunctionSource, guardLoops, LoopGuardError } from './loopGuard';

/** Runs `code` (a function body) after guarding its loops with a 50 ms budget. */
function run(code: string, budgetMs = 50) {
  const trips: string[] = [];
  const g = createLoopGuard({ budgetMs, onTrip: (e) => trips.push(e.message) });
  const guarded = guardLoops(code, '__g');
  const result = new Function('__g', guarded)(g);
  return { result, trips, guarded };
}

test('endless loops of every kind throw once their budget is spent', () => {
  for (const code of [
    'while (true) {}',
    'while (1) ;',
    'for (;;) {}',
    'do {} while (true)',
    'for (const x of (function* () { while (true) yield 1; })()) {}',
    'const f = () => { while (true) {} }; [1, 2].map(f)',
    'outer: while (true) { inner: for (;;) { continue outer; } }',
    'while (true) { try { while (true) {} } catch (e) {} }',          // a caught inner trip: the outer loop trips too
    'if (true) while (true) x = 1; var x',
  ]) {
    const t = Date.now();
    expect(() => run(code), code).toThrow(LoopGuardError);
    expect(Date.now() - t, code).toBeLessThan(2000);
  }
});

test('finite loops keep their meaning, labels and control flow included', () => {
  expect(run('let s = 0; for (let i = 0; i < 1000; i++) s += i; return s').result).toBe(499500);
  expect(run('let s = 0; outer: for (let i = 0; i < 5; i++) { for (let j = 0; j < 5; j++) { if (j > i) continue outer; if (i === 4) break outer; s++; } } return s').result).toBe(10);
  expect(run('let n = 0; do n++; while (n < 7); return n').result).toBe(7);
  expect(run('let a = []; for (const k in { x: 1, y: 2 }) a.push(k); for (const v of [3, 4]) a.push(v); return a.join()').result).toBe('x,y,3,4');
  expect(run('let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s++; return s').result).toBe(9);
  expect(run('let s = 0; a: b: for (let i = 0; i < 3; i++) { if (i === 1) continue a; s += i; } return s').result).toBe(2);
  const { result, trips } = run('let s = 0; for (let i = 0; i < 2e6; i++) s++; return s', 5000);   // long but finite: fine
  expect(result).toBe(2e6);
  expect(trips).toEqual([]);
  expect(guardLoops('const x = 1 + 2', '__g')).toBe('const x = 1 + 2');                            // no loops: unchanged
});

test('works on the transpiler output form (async IIFE with return) and reports the trip', () => {
  const code = '(async ()=>{let x = 0; while (true) { x++; } return x;})()';
  const guarded = guardLoops(code, '__g');
  expect(guarded).toContain('{const __g_0=__g();while (true) {__g_0(); x++; }}');
  const trips: string[] = [];
  const g = createLoopGuard({ budgetMs: 20, onTrip: (e) => trips.push(e.message) });
  return new Function('__g', `return ${guarded}`)(g).then(() => { throw new Error('no trip'); }, (e: Error) => {
    expect(e).toBeInstanceOf(LoopGuardError);
    expect(trips[0]).toMatch(/ran for more than 20 ms/);
  });
});

test('an endless await chain is stopped by the microtask count; normal awaits pass', async () => {
  const trips: string[] = [];
  const g = createLoopGuard({ budgetMs: 50, maxMicrotasks: 1000, onTrip: (e) => trips.push(e.message) });
  const guarded = guardLoops('const f = async () => { await null; return f(); }; return f();', '__g');
  expect(guarded).toContain('await __g.a(null)');
  await expect(new Function('__g', guarded)(g)).rejects.toThrow(/more than 1000 promise callbacks/);
  expect(trips).toHaveLength(1);
  // a short chain, and the counter resets after a macrotask
  const ok = guardLoops('let n = 0; for (let i = 0; i < 500; i++) { await i; n++ } return n', '__g');
  expect(await new Function('__g', `return (async () => { ${ok} })()`)(g)).toBe(500);
  await new Promise((r) => setTimeout(r, 5));
  expect(await new Function('__g', `return (async () => { ${ok} })()`)(g)).toBe(500);
});

test('functions built at runtime are guarded with their parameters and kind', async () => {
  const g = createLoopGuard({ budgetMs: 30 });
  const src = guardFunctionSource('', false, ['a', 'b = (() => { let s = 0; for (let i = 0; i < 3; i++) s++; return s })()'], 'while (a) { a-- } return b', '__g');
  const f = new Function('__g', `return ${src}`)(g);
  expect(f(5)).toBe(3);
  expect(f.name).toBe('anonymous');
  const spin = new Function('__g', `return ${guardFunctionSource('', false, [], 'while (true) {}', '__g')}`)(g);
  expect(() => spin()).toThrow(LoopGuardError);
  await Promise.resolve();                                   // the trip lasts for the synchronous run only
  const gen = new Function('__g', `return ${guardFunctionSource('', true, ['n'], 'for (let i = 0; i < n; i++) yield i', '__g')}`)(g);
  expect([...gen(3)]).toEqual([0, 1, 2]);
});

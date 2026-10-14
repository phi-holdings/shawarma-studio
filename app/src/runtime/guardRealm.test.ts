import vm from 'node:vm';
import { expect, test } from 'vitest';
import { createLoopGuard } from '@shawarma/shared';
import { installRealmGuards } from './guardRealm';

/** A fresh JS realm with the guards installed (like the song runtime's), and a way to run code in it. */
function realm(budgetMs = 40, maxMicrotasks = 2000) {
  // errors thrown by guarded callbacks surface where the browser would report them; collected here
  const thrown: unknown[] = [];
  const catching = (fn: unknown) => () => { try { (fn as () => void)(); } catch (e) { thrown.push(e); } };
  const ctx = vm.createContext({
    setTimeout: (fn: unknown, ms?: number) => setTimeout(catching(fn), ms),
    setInterval: (fn: unknown, ms?: number) => setInterval(catching(fn), ms),
    queueMicrotask: (fn: unknown) => queueMicrotask(catching(fn)),
    console,
  });
  const g = vm.runInContext('globalThis', ctx) as typeof globalThis;
  const trips: string[] = [];
  const guard = createLoopGuard({ budgetMs, maxMicrotasks, onTrip: (e) => trips.push(e.message) });
  Object.defineProperty(g, '__G', { value: guard, writable: false, configurable: false });
  installRealmGuards('__G', guard, g);
  return { run: (code: string) => vm.runInContext(code, ctx, { timeout: 3000 }), trips, thrown };
}

test('loops in code built at runtime are guarded: eval, Function, async/generator constructors, string timers', async () => {
  const r = realm();
  for (const code of [
    "eval('while (true) {}')",
    "Function('while (true) {}')()",
    "new Function('a', 'for (;;) {}')(1)",
    "(function () {}).constructor('do {} while (true)')()",
    "(async function () {}).constructor('while (true) {}')()",
    "[...(function* () {}).constructor('while (true) {}')()]",
    "(async function* () {}).constructor('while (true) {}')().next()",
  ]) {
    let outcome: unknown;
    try { outcome = await r.run(code); } catch (e) { outcome = e; }
    expect(String((outcome as Error)?.message), code).toMatch(/ran for more than 40 ms/);
    await new Promise((res) => setTimeout(res, 0));
  }
  // a string timer: the error surfaces in the timer, the loop does not spin
  const t = Date.now();
  r.run("setTimeout('while (true) {}', 0)");
  await new Promise((res) => setTimeout(res, 100));
  expect(Date.now() - t).toBeLessThan(1000);
  expect(r.trips.some((m) => /ran for more than/.test(m))).toBe(true);
});

test('runtime-built code still works; the originals cannot be put back', () => {
  const r = realm();
  expect(r.run("Function('a', 'b', 'let s = 0; for (let i = a; i < b; i++) s += i; return s')(0, 5)")).toBe(10);
  expect(r.run("eval('1 + 2')")).toBe(3);
  expect(r.run("(function* () {}).constructor('n', 'for (let i = 0; i < n; i++) yield i')")(3).next().value).toBe(0);
  expect(r.run('(() => {}) instanceof Function')).toBe(true);
  expect(r.run("Function.prototype.constructor === Function && (async () => {}).constructor.name")).toBe('AsyncFunction');
  for (const attempt of ["Function = function () {}", "globalThis.eval = (x) => x", "Promise.prototype.then = () => {}", "queueMicrotask = () => {}", "(function () {}).constructor.prototype.constructor = null"]) {
    expect(() => r.run(`'use strict'; ${attempt}`), attempt).toThrow(/read.only|Cannot assign/);
  }
});

test('endless promise / microtask chains are stopped; ordinary promise use is not', async () => {
  const r = realm(40, 2000);
  const thenChain = r.run('new Promise((resolve, reject) => { const f = () => { Promise.resolve().then(f).catch(reject) }; f(); })') as Promise<unknown>;
  await expect(thenChain).rejects.toThrow(/more than 2000 promise callbacks/);
  await new Promise((res) => setTimeout(res, 5));
  const qm = r.run('new Promise((resolve, reject) => { let n = 0; const f = () => { n++; try { queueMicrotask(f) } catch (e) { reject(e) } }; queueMicrotask(f); setTimeout(() => resolve(n), 50) })') as Promise<number>;
  // the chain stops at the limit (the throw ends it); the timer then fires
  expect(await qm).toBeLessThanOrEqual(2001);
  expect(r.trips.filter((m) => /promise callbacks/.test(m)).length).toBeGreaterThanOrEqual(2);
  await new Promise((res) => setTimeout(res, 5));
  expect(await r.run('Promise.all([1, 2, 3].map((x) => Promise.resolve(x).then((y) => y * 2)))')).toEqual([2, 4, 6]);
});

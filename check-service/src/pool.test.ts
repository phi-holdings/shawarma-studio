import { afterEach, expect, test } from 'vitest';
import { Sandbox, SandboxBusyError, SandboxSupersededError, SandboxTimeoutError, defaultWorkers } from './sandbox';

// The pool's scheduling: users in turn, capped queues, superseded checks dropped, wall-clock budgets.

const HANG = 'while (true) {}\ns("bd")';
const quick = (s: string) => `s("${s}")`;
const pools: Sandbox[] = [];
afterEach(() => { for (const p of pools.splice(0)) p.kill(); });

/** A pool with its spares started and ready; `pids` collects the pid of every child that ran a check. */
async function pool(opts: ConstructorParameters<typeof Sandbox>[0]) {
  const pids = new Set<number>();
  const p = new Sandbox({ ...opts, readRss: async (pid) => { pids.add(pid); return 50 * 1024 ** 2; }, pollMs: 50 });
  pools.push(p);
  p.prewarm();
  await Promise.all((p as unknown as { spares: Promise<unknown>[] }).spares);
  return { p, pids };
}
const inspect = (p: Sandbox, code: string, user: string, supersede?: string) =>
  p.call<{ sounds: string[] }>({ op: 'inspect', args: { code } }, { user, supersede });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const settle = <T>(pr: Promise<T>) => pr.then((v) => ({ ok: true as const, v, at: Date.now() }), (e: Error) => ({ ok: false as const, e, at: Date.now() }));

test('default workers: about half the cores, 1 to 3; CHECK_WORKERS wins', () => {
  expect(defaultWorkers({}, 1)).toBe(1);
  expect(defaultWorkers({}, 4)).toBe(2);
  expect(defaultWorkers({}, 16)).toBe(3);
  expect(defaultWorkers({ CHECK_WORKERS: '5' }, 4)).toBe(5);
  expect(defaultWorkers({ CHECK_WORKERS: 'x' }, 4)).toBe(2);
});

test('two workers: hanging songs from one user never delay another user', async () => {
  const { p } = await pool({ workers: 2, opTimeoutMs: 2000, maxTotalMs: 20_000 });
  const x = [settle(inspect(p, HANG, 'x')), settle(inspect(p, HANG, 'x')), settle(inspect(p, HANG, 'x'))];
  await new Promise((r) => setTimeout(r, 100));
  const t = Date.now();
  const y = await inspect(p, quick('sd'), 'y');
  expect(y.sounds).toEqual(['sd']);
  expect(Date.now() - t).toBeLessThan(1500); // x holds one worker at most: y got the other one at once
  for (const r of await Promise.all(x)) expect(!r.ok && r.e).toBeInstanceOf(SandboxTimeoutError);
}, 30_000);

test('one worker: another user waits for at most the one check already running', async () => {
  const { p } = await pool({ workers: 1, opTimeoutMs: 1500, maxTotalMs: 20_000 });
  const t = Date.now();
  const x1 = settle(inspect(p, HANG, 'x'));
  const x2 = settle(inspect(p, HANG, 'x'));
  const x3 = settle(inspect(p, HANG, 'x'));
  const y = await settle(inspect(p, quick('sd'), 'y'));
  expect(y.ok && y.v.sounds).toEqual(['sd']);
  expect(y.at - t).toBeLessThan(1500 + 1200); // x1, then y (users in turn), not x2 and x3 first
  const [r1, r2, r3] = await Promise.all([x1, x2, x3]);
  expect(r1.at).toBeLessThan(y.at);
  expect(r2.at).toBeGreaterThan(y.at);
  expect(r3.at).toBeGreaterThan(r2.at);
}, 30_000);

test('a newer check with the same key replaces the waiting one; other checks stay', async () => {
  const { p } = await pool({ workers: 1, opTimeoutMs: 1000, maxTotalMs: 20_000 });
  const busy = settle(inspect(p, HANG, 'x'));               // holds the worker
  await new Promise((r) => setTimeout(r, 50));
  const kept = settle(inspect(p, quick('kept'), 'x'));       // e.g. a save check: no key
  const a = settle(inspect(p, quick('a'), 'x', 'typing'));
  const b = settle(inspect(p, quick('b'), 'x', 'typing'));
  const other = settle(inspect(p, quick('o'), 'y', 'typing')); // another user's key is separate
  expect(p.queued('x')).toBe(2);
  const c = await inspect(p, quick('c'), 'x', 'typing');
  expect(c.sounds).toEqual(['c']);
  for (const r of [await a, await b]) expect(!r.ok && r.e).toBeInstanceOf(SandboxSupersededError);
  expect((await kept).ok).toBe(true);
  expect((await other).ok).toBe(true);
  expect((await busy).ok).toBe(false);
}, 30_000);

test("a user's waiting checks are capped; more are refused as busy", async () => {
  const { p } = await pool({ workers: 1, opTimeoutMs: 800, maxQueuedPerUser: 2, maxTotalMs: 20_000 });
  const running = settle(inspect(p, HANG, 'x'));
  await new Promise((r) => setTimeout(r, 50));
  const q = [settle(inspect(p, quick('a'), 'x')), settle(inspect(p, quick('b'), 'x'))];
  await expect(inspect(p, quick('c'), 'x')).rejects.toBeInstanceOf(SandboxBusyError);
  expect((await inspect(p, quick('y'), 'y')).sounds).toEqual(['y']); // other users are not affected
  for (const r of await Promise.all(q)) expect(r.ok).toBe(true);
  await running;
}, 30_000);

test('the run limit kills the child', async () => {
  const { p, pids } = await pool({ workers: 1, opTimeoutMs: 800, maxTotalMs: 20_000 });
  const t = Date.now();
  await expect(inspect(p, HANG, 'x')).rejects.toBeInstanceOf(SandboxTimeoutError);
  expect(Date.now() - t).toBeLessThan(800 + 1000);
  expect(pids.size).toBe(1);
  await new Promise((r) => setTimeout(r, 100));
  for (const pid of pids) expect(alive(pid)).toBe(false);
}, 30_000);

test('the wall-clock budget answers busy in time, for a running check (child killed) and a waiting one', async () => {
  const { p, pids } = await pool({ workers: 1, opTimeoutMs: 10_000, maxTotalMs: 1000 });
  const t = Date.now();
  const running = settle(inspect(p, HANG, 'x'));
  const waiting = settle(inspect(p, quick('w'), 'y'));
  const [r, w] = await Promise.all([running, waiting]);
  expect(!r.ok && r.e).toBeInstanceOf(SandboxBusyError);
  expect(!w.ok && w.e).toBeInstanceOf(SandboxBusyError);
  expect(Math.max(r.at, w.at) - t).toBeLessThan(1500);
  await new Promise((res) => setTimeout(res, 100));
  for (const pid of pids) expect(alive(pid)).toBe(false);
  expect((await inspect(p, quick('after'), 'y')).sounds).toEqual(['after']); // the pool goes on
}, 30_000);

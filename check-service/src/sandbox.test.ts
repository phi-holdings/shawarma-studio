import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { inspect, queryEvents } from './inspect';
import { HARD_TIMEOUT_MS, MEMORY_LIMIT_BYTES, RSS_MAX_MISSES, Sandbox, SandboxMemoryError, prewarmSandbox, rssBytes, sandboxExecArgv, stopSandbox } from './sandbox';

afterAll(() => stopSandbox());

test('an endless loop returns an eval_error within the hard timeout, and the sandbox recovers', async () => {
  const t = Date.now();
  const r = await inspect('while (true) {}\ns("bd")');
  const took = Date.now() - t;
  expect(r.ok).toBe(false);
  expect(r.issues[0].kind).toBe('eval_error');
  expect(r.error).toMatch(/timed out/);
  expect(took).toBeLessThan(HARD_TIMEOUT_MS + 1500);
  const ok = await inspect('s("bd sd")');
  expect(ok.ok).toBe(true);
  expect(ok.sounds).toEqual(['bd', 'sd']);
}, 30_000);

test('evaluated code cannot see the API key or any server env', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
  stopSandbox(); // force a fresh child spawned while the key is set
  // Strudel turns "double quoted" strings into patterns, so plain strings use single quotes here
  const r = await inspect(`s(process.env.ANTHROPIC_API_KEY === undefined && process.env.PATH === undefined && process.env.HOME === undefined ? 'bd' : 'leak')`);
  expect(r.sounds).toEqual(['bd']);
});

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');

/** Run a trusted CommonJS snippet in a process with the sandbox's flags; resolves its stdout lines. */
function runWithSandboxFlags(script: string, opts: { harden: boolean; preload?: string[] }): Promise<string[]> {
  const args = [...(opts.preload ?? []), ...sandboxExecArgv({ harden: opts.harden }), '--input-type=commonjs', '-e', script];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { env: {}, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve(stdout.trim().split('\n'));
    });
  });
}
const TRY = `const t = (label, f) => { try { f(); console.log(label + ' allowed') } catch (e) { console.log(label + ' denied ' + (e.code ?? '')) } };`;

test('permission model alone (no hardening): no file writes, no reads outside node_modules, no processes', async () => {
  const lines = await runWithSandboxFlags(`${TRY}
    const fs = require('node:fs');
    t('write', () => fs.writeFileSync('/tmp/shawarma-sandbox-probe', 'x'));
    t('read /etc/hosts', () => fs.readFileSync('/etc/hosts'));
    t('read server package.json', () => fs.readFileSync(${JSON.stringify(path.join(serverDir, 'package.json'))}));
    t('spawn', () => require('node:child_process').execSync('true'));
    t('read strudel package.json', () => fs.readFileSync(${JSON.stringify(path.join(serverDir, 'node_modules/@strudel/core/package.json'))}));`, { harden: false });
  expect(lines).toEqual([
    'write denied ERR_ACCESS_DENIED',
    'read /etc/hosts denied ERR_ACCESS_DENIED',
    'read server package.json denied ERR_ACCESS_DENIED',
    'spawn denied ERR_ACCESS_DENIED',
    'read strudel package.json allowed', // control: the probe does report allowed reads
  ]);
});

test('built-ins outside the (empty) allowlist are refused on the require and createRequire paths', async () => {
  const preload = ['--require', path.join(here, 'sandbox', '__fixtures__', 'early-require.cjs')];
  const lines = await runWithSandboxFlags(`${TRY}
    for (const id of ['node:fs', 'fs', 'node:path', 'http', 'node:child_process', 'node:module', 'node:vm', 'worker_threads']) {
      t('require ' + id, () => require(id));
      t('createRequire ' + id, () => globalThis.earlyRequire(id));
    }
    t('getBuiltinModule path', () => process.getBuiltinModule('node:path'));`, { harden: true, preload });
  expect(lines.filter((l) => !l.includes('denied ERR_ACCESS_DENIED'))).toEqual([]);
  expect(lines).toHaveLength(17);
});

test('queries run in the sandbox too', async () => {
  const q = await queryEvents('note("c4 e4").s("sine")', 0, 1);
  expect(q.events.map((r) => r.note)).toEqual(['c4', 'e4']);
  expect(q.clipped).toBe(false);
});

// Strudel turns "double quoted" strings into patterns, so plain strings use single quotes in song code
const probe = (stmt: string) => `let r = 'denied'; try { ${stmt}; r = 'allowed' } catch (e) {}\ns(r)`;

test('evaluated code has no outbound network', async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); res.end('ok'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/probe`;
  try {
    for (const stmt of [
      `await fetch('${url}')`,
      `new WebSocket('ws://127.0.0.1:${port}/')`,
      `await import('node:http')`,
      `await import('https')`,
      `await import('node:net')`,
      `await import('node:child_process')`,
      `await import('node:module')`,
      `await import('data:text/javascript,export * from "node:http"')`,
      `process.getBuiltinModule('node:net').connect(${port}, '127.0.0.1')`,
      `process.getBuiltinModule('http').get('${url}')`,
      `process.getBuiltinModule('dgram')`,
      `process.getBuiltinModule('node:dns')`,
      `process.getBuiltinModule('module').registerHooks({})`,
      // allowlist, not denylist: every other built-in is refused too, with or without the prefix
      `await import('node:fs')`,
      `await import('fs')`,
      `await import('node:path')`,
      `await import('node:vm')`,
      `await import('node:worker_threads')`,
      `await import('node:sqlite')`,
      `await import('node:test')`,
      `await import('data:text/javascript,export * from "node:fs"')`,
      `process.getBuiltinModule('node:url')`,
      `process.getBuiltinModule('path')`,
      `process.getBuiltinModule('node:fs')`,
      `process.binding('tcp_wrap')`,
      `process._linkedBinding('tcp_wrap')`,
      `if (typeof EventSource === 'undefined' && typeof XMLHttpRequest === 'undefined') throw new Error('absent')`,
    ]) {
      const r = await inspect(probe(stmt));
      expect(r.sounds, stmt).toEqual(['denied']);
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(hits).toEqual([]);
    // control: the probe reports allowed statements, and normal inspection still works
    expect((await inspect(probe(`await Promise.resolve(1)`))).sounds).toEqual(['allowed']);
    const ok = await inspect('note("c4 e4 g4").s("sine")');
    expect(ok.ok).toBe(true);
    expect(ok.sounds).toEqual(['sine']);
  } finally {
    server.close();
  }
}, 30_000);

test('evaluated code cannot signal other processes or take over the child process', async () => {
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    for (const stmt of [
      `process.kill(${victim.pid}, 'SIGKILL')`,
      `process.kill(process.pid, 'SIGKILL')`,
      `process.chdir('/')`,
      `process.dlopen({}, '/tmp/x.node')`,
      `process.exit(3)`,
      `process.reallyExit(3)`,
      `process.abort()`,
      `process.kill = null; process.kill(0)`,
    ]) {
      const r = await inspect(probe(stmt));
      expect(r.sounds, stmt).toEqual(['denied']);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(victim.exitCode).toBeNull();
    expect(victim.signalCode).toBeNull();
    // the child's own IPC still works
    expect((await inspect('s("bd")')).ok).toBe(true);
  } finally {
    victim.kill('SIGKILL');
  }
}, 30_000);

test('every operation runs in a fresh child: nothing a song does carries over to the next request', async () => {
  const pidOf = async () => (await inspect(`s('p' + process.pid)`)).sounds[0];
  const a = await pidOf();
  const b = await pidOf();
  expect(a).toMatch(/^p\d+$/);
  expect(b).not.toBe(a);

  const next = async (label: string) => {
    const t = Date.now();
    const r = await inspect(`s(globalThis.leak === undefined ? 'bd' : 'leak')`);
    expect(r.sounds, label).toEqual(['bd']);
    expect(Date.now() - t, label).toBeLessThan(1500);
  };
  for (const code of [
    // global state
    `globalThis.leak = 1\ns("bd")`,
    // removed listeners: the next child still answers
    `process.removeAllListeners('message'); process.removeAllListeners('disconnect')\ns("bd")`,
    // forged replies (every plausible id) and fake ready messages
    `for (let i = 0; i < 50; i++) process.send({ id: i, ok: true, result: { cps: 9, sounds: ['leak'] } }); process.send({ ready: true })\ns("bd")`,
    // lingering timers that would hog a reused child
    `setTimeout(function f() { setTimeout(f, 0); const t = Date.now(); while (Date.now() - t < 3000) {} }, 0)\ns("bd")`,
    `setInterval(() => { while (true) {} }, 300)\ns("bd")`,
    `const c = new MessageChannel(); c.port1.onmessage = () => { const t = Date.now(); while (Date.now() - t < 500) {} c.port2.postMessage(0) }; c.port2.postMessage(0)\ns("bd")`,
  ]) {
    expect((await inspect(code)).ok, code).toBe(true);
    await new Promise((r) => setTimeout(r, 400)); // give leftovers the chance to fire
    await next(code);
  }
}, 60_000);

test('a microtask loop cannot outlive its operation', async () => {
  // the reply may or may not get out before the loop starves the child; either way the child is killed
  const r = await inspect(`(function f() { queueMicrotask(f) })()\ns("bd")`);
  if (!r.ok) expect(r.error).toMatch(/timed out/);
  const t = Date.now();
  expect((await inspect('s("sd")')).sounds).toEqual(['sd']);
  expect(Date.now() - t).toBeLessThan(1500);
}, 30_000);

test('with a warm spare ready, a request does not wait for a child to start', async () => {
  await inspect('s("bd")');
  prewarmSandbox();
  await new Promise((r) => setTimeout(r, 1500)); // the spare starts while the user is idle
  const t = Date.now();
  expect((await inspect('s("bd sd")')).ok).toBe(true);
  expect(Date.now() - t).toBeLessThan(250);
}, 30_000);

test('memory outside the V8 heap is bounded: the child is killed above 1 GB resident', async () => {
  expect(MEMORY_LIMIT_BYTES).toBe(1024 ** 3);
  expect(await rssBytes(process.pid)).toBeGreaterThan(10 * 1024 * 1024); // the probe works on this OS
  // ArrayBuffers live outside the 512 MB V8 heap cap; fill() makes the pages resident
  const r = await inspect('const keep = []; while (true) keep.push(new Uint8Array(32 * 1024 * 1024).fill(1))\ns("bd")');
  expect(r.ok).toBe(false);
  expect(r.issues[0].kind).toBe('eval_error');
  expect(r.error).toMatch(/evaluation used too much memory/);
  expect((await inspect('s("bd sd")')).ok).toBe(true);
}, 30_000);

test('an allocation bomb fails and the sandbox recovers', async () => {
  const r = await inspect('const a = []; while (true) a.push(new Array(1e6).fill(1.5))\ns("bd")');
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/evaluation process exited|timed out|too much memory/);
  expect(r.issues[0].kind).toBe('eval_error');
  const ok = await inspect('s("bd sd")');
  expect(ok.ok).toBe(true);
}, 30_000);

test('a child whose memory cannot be read 3 times in a row is killed with an error; isolated misses are tolerated', async () => {
  expect(RSS_MAX_MISSES).toBe(3);
  const busy = (ms: number) => `const t0 = Date.now(); while (Date.now() - t0 < ${ms}) {}\ns("bd")`;
  let reads = 0;
  const blind = new Sandbox({ readRss: async () => { reads++; return null; }, pollMs: 50 });
  try {
    const t = Date.now();
    await expect(blind.call({ op: 'inspect', args: { code: busy(4000) } })).rejects.toThrow(SandboxMemoryError);
    await expect(blind.call({ op: 'inspect', args: { code: busy(4000) } })).rejects.toThrow(/could not read the evaluation's memory use 3 times/);
    expect(Date.now() - t).toBeLessThan(4000);   // well before either loop would have ended
    expect(reads).toBeGreaterThanOrEqual(6);
  } finally { blind.kill(); }
  // two misses, then a reading, repeatedly: never three in a row, the request completes
  let n = 0;
  const flaky = new Sandbox({ readRss: async () => (++n % 3 === 0 ? 50 * 1024 ** 2 : null), pollMs: 50 });
  try {
    const r = await flaky.call<{ sounds: string[] }>({ op: 'inspect', args: { code: busy(600) } });
    expect(r.sounds).toEqual(['bd']);
    expect(n).toBeGreaterThanOrEqual(6);
  } finally { flaky.kill(); }
}, 30_000);

test('precheck: a song that hangs while evaluating or in its first cycles / section starts times out in ~3 s', async () => {
  const { sandboxPrecheck, PRECHECK_TIMEOUT_MS, SandboxTimeoutError } = await import('./sandbox');
  expect(PRECHECK_TIMEOUT_MS).toBe(3000);
  const ok = await sandboxPrecheck('arrange([4, s("bd*2")], [4, s("hh*4")])');
  expect(ok).toMatchObject({ windows: 2, cutShort: false });
  expect(ok.cyclesQueried).toBe(8 + 2);
  for (const code of [
    'while (true) {}\ns("bd")',
    's("bd").fmap(() => { while (true) {} })',
    'const f = (x) => { while (true) {} return x }\nnote("c e").fmap(f)',
    // only the second section hangs: its start is queried too
    "arrange([4, s('bd')], [4, s('hh').fmap(() => { for (;;) {} })])",
  ]) {
    const t = Date.now();
    await expect(sandboxPrecheck(code), code).rejects.toThrow(SandboxTimeoutError);
    expect(Date.now() - t, code).toBeLessThan(PRECHECK_TIMEOUT_MS + 2500);
  }
  expect((await sandboxPrecheck('s("bd sd")')).cutShort).toBe(false);   // the sandbox recovers
}, 60_000);

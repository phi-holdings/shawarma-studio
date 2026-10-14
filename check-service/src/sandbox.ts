import { execFile, fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from "node:fs";
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis, PrecheckResult, QueryResult } from './sandbox/core.mjs';
import { INSPECT_DEADLINE_MS } from './sandbox/limits.mjs';

// User (and model-written) Strudel code is arbitrary JavaScript. It is evaluated in a child process that
//  - runs under the Node permission model: read-only access to node_modules + check-service/src only, no fs
//    writes, no child processes, no workers/addons;
//  - is hardened by sandbox/harden.mjs before user code runs: an allowlist (currently empty) of node:
//    built-ins, no network globals, no process.kill/exit/chdir/binding;
//  - serves exactly one request and is then killed (a warm spare is always being prepared), so no state,
//    listener, timer or microtask loop survives into another request;
//  - is capped at a 512 MB V8 heap, and killed by the parent when its resident memory (which includes
//    ArrayBuffers and other off-heap allocations) exceeds MEMORY_LIMIT_BYTES;
//  - gets an empty environment (no ANTHROPIC_API_KEY or anything else from the server's env);
//  - is killed when a request exceeds HARD_TIMEOUT_MS (endless loops, huge single cycles).
// Requests are serialised (one in flight).

export const HARD_TIMEOUT_MS = INSPECT_DEADLINE_MS + 1000;
/** Pre-flight before the browser runs a song: a song still busy after this is refused as hanging. */
export const PRECHECK_TIMEOUT_MS = 3000;
const opTimeout = (op: Op['op']) => (op === 'precheck' ? PRECHECK_TIMEOUT_MS : HARD_TIMEOUT_MS);
const STARTUP_TIMEOUT_MS = 30_000;

const engineDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(engineDir, '..');
const repoRoot = path.resolve(serverDir, '..');
const outerModules = path.join(repoRoot, '..', 'node_modules');
const childScript = path.join(engineDir, 'sandbox', 'child.mjs');
const registerHook = path.join(engineDir, 'register.mjs');
const hardenPrelude = path.join(engineDir, 'sandbox', 'harden.mjs');

const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';

export function sandboxExecArgv(opts: { harden?: boolean } = {}): string[] {
  const harden = opts.harden ?? true;
  return [
    permissionFlag,
    // module resolution walks up from check-service/src looking for node_modules, so check-service/src must be readable
    `--allow-fs-read=${path.join(serverDir, 'src')}`,
    `--allow-fs-read=${path.join(serverDir, 'node_modules')}`,
    `--allow-fs-read=${path.join(repoRoot, 'node_modules')}`,
    // when studio/ is mounted inside the platform repo, pnpm installs everything at that outer root
    ...(existsSync(outerModules) ? [`--allow-fs-read=${outerModules}`] : []),
    // an allocation bomb crashes the child (and is restarted) long before it can hurt the machine
    '--max-old-space-size=512',
    '--disable-warning=ExperimentalWarning',
    '--import',
    registerHook,
    // child-only: built-in allowlist, no network, no signals/process control, timer teardown
    // (harden: false exists only so tests can check the permission-model layer on its own)
    ...(harden ? ['--import', hardenPrelude] : []),
  ];
}

export class SandboxTimeoutError extends Error {}
export class SandboxMemoryError extends Error {}

/** Resident memory (V8 heap + ArrayBuffers + native allocations) above which a child is killed. */
export const MEMORY_LIMIT_BYTES = 1024 ** 3;
/** How often the parent samples a running child's resident set size. */
export const RSS_POLL_MS = 250;

/** Consecutive failed RSS reads after which a running child is killed (memory can't be policed). */
export const RSS_MAX_MISSES = 3;

/**
 * Resident set size of another process in bytes, or null when it cannot be read (process gone).
 * process.memoryUsage() only covers the calling process, so: /proc on Linux, /bin/ps elsewhere (macOS;
 * an absolute path, so nothing on PATH can stand in for it).
 */
export async function rssBytes(pid: number): Promise<number | null> {
  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => null);
    const kb = status?.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1];
    return kb ? Number(kb) * 1024 : null;
  }
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2000 }, (err, stdout) => {
      const kb = Number(String(stdout).trim());
      resolve(err || !Number.isFinite(kb) || kb <= 0 ? null : kb * 1024);
    });
  });
}

type Op = { op: 'inspect'; args: { code: string } } | { op: 'precheck'; args: { code: string } } | { op: 'query'; args: { code: string; fromCycle: number; toCycle: number; sound?: string; limit?: number } };

interface Child { proc: ChildProcess; stderr: () => string }

/**
 * Fresh child per operation, with a warm spare: every request is served by a pre-spawned, already
 * initialised child that is used exactly once and then killed; a replacement spare is spawned in the
 * background as soon as the previous one is taken. Requests are still serialised (one in flight).
 */
export interface SandboxOptions {
  /** RSS probe (tests inject one). */
  readRss?: (pid: number) => Promise<number | null>;
  pollMs?: number;
}

export class Sandbox {
  constructor(private readonly opts: SandboxOptions = {}) {}
  private spare: Promise<Child> | null = null;
  private live = new Set<ChildProcess>();
  private queue: Promise<unknown> = Promise.resolve();

  private spawn(): Promise<Child> {
    let stderr = '';
    const proc = fork(childScript, [], {
      execPath: process.execPath,
      execArgv: sandboxExecArgv(),
      env: {},
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    this.live.add(proc);
    proc.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const ready = new Promise<Child>((resolve, reject) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('evaluation sandbox did not start')); }, STARTUP_TIMEOUT_MS);
      timer.unref();
      const onReady = (m: any) => {
        if (m?.ready) {
          clearTimeout(timer);
          proc.off('message', onReady);
          resolve({ proc, stderr: () => stderr });
        }
      };
      proc.on('message', onReady);
      proc.once('exit', (codeNum) => {
        clearTimeout(timer);
        reject(new Error(`evaluation sandbox exited (${codeNum}): ${stderr.trim().slice(-500)}`));
      });
      proc.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
    proc.once('exit', () => {
      this.live.delete(proc);
      if (this.spare === ready) this.spare = null; // a spare that died while idle is replaced on demand
    });
    ready.catch(() => { if (this.spare === ready) this.spare = null; });
    // never keep the server (or a test worker) alive just for the sandbox
    proc.unref();
    (proc as any).channel?.unref?.();
    return ready;
  }

  /** Start a spare child now (if none is ready or starting) so the next request does not wait for it. */
  prewarm() {
    this.spare ??= this.spawn();
  }

  private async take(): Promise<Child> {
    const spare = this.spare ?? this.spawn();
    this.spare = null;
    this.prewarm(); // the replacement starts while this request runs
    const child = await spare.catch(() => this.spawn()); // a spare that failed to start gets one retry
    return child.proc.connected ? child : this.spawn();
  }

  kill() {
    const spare = this.spare;
    this.spare = null;
    spare?.catch(() => undefined);
    for (const proc of this.live) proc.kill('SIGKILL');
    this.live.clear();
  }

  call<T>(req: Op): Promise<T> {
    const run = () => this.dispatch<T>(req);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async dispatch<T>(req: Op): Promise<T> {
    const { proc, stderr } = await this.take();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        proc.off('message', onMessage);
        proc.off('exit', onExit);
        proc.kill('SIGKILL'); // single use: whatever the song left behind dies with the process
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new SandboxTimeoutError(`evaluation timed out after ${opTimeout(req.op) / 1000} s (endless loop or far too much work?)`)));
      }, opTimeout(req.op));
      // memory outside the V8 heap (ArrayBuffers, native allocations) is not bounded by
      // --max-old-space-size, so the parent watches the child's resident set size
      // (an unreadable RSS means the limit can't be enforced: after RSS_MAX_MISSES in a row the child goes)
      let sampling = false;
      let misses = 0;
      const readRss = this.opts.readRss ?? rssBytes;
      const poll = setInterval(async () => {
        if (sampling || settled || proc.pid === undefined) return;
        sampling = true;
        const rss = await readRss(proc.pid).catch(() => null);
        sampling = false;
        if (settled) return;
        misses = rss === null ? misses + 1 : 0;
        if (misses >= RSS_MAX_MISSES) {
          finish(() => reject(new SandboxMemoryError(`could not read the evaluation's memory use ${RSS_MAX_MISSES} times in a row; it was stopped`)));
        } else if (rss !== null && rss > MEMORY_LIMIT_BYTES) {
          finish(() => reject(new SandboxMemoryError(`evaluation used too much memory (over ${MEMORY_LIMIT_BYTES / 1024 ** 3} GB); it was stopped`)));
        }
      }, this.opts.pollMs ?? RSS_POLL_MS);
      const onMessage = (m: any) => {
        if (m?.id !== id) return;
        finish(() => (m.ok ? resolve(m.result as T) : reject(new Error(String(m.error)))));
      };
      const onExit = () => {
        finish(() => reject(new Error(`evaluation process exited: ${stderr().trim().slice(-500) || 'no output'}`)));
      };
      proc.on('message', onMessage);
      proc.once('exit', onExit);
      proc.send({ id, ...req }, (err) => {
        if (err) finish(() => reject(err));
      });
    });
  }
}

const sandbox = new Sandbox();
/** Pre-flight checks get their own children, so they never wait behind a slow inspect of the same song. */
const precheckSandbox = new Sandbox();

export function sandboxAnalyse(code: string): Promise<Analysis> {
  return sandbox.call<Analysis>({ op: 'inspect', args: { code } });
}

export function sandboxPrecheck(code: string): Promise<PrecheckResult> {
  return precheckSandbox.call<PrecheckResult>({ op: 'precheck', args: { code } });
}

export function sandboxQuery(code: string, fromCycle: number, toCycle: number, sound?: string, limit?: number): Promise<QueryResult> {
  return sandbox.call<QueryResult>({ op: 'query', args: { code, fromCycle, toCycle, sound, limit } });
}

/** Spawn the warm spare ahead of the first request (called at server start). */
export function prewarmSandbox() {
  sandbox.prewarm();
  precheckSandbox.prewarm();
}

/** Test hook: stop every sandbox process (the spare included). */
export function stopSandbox() {
  sandbox.kill();
  precheckSandbox.kill();
}

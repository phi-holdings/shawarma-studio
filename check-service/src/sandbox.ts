import { execFile, fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
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
// A small pool runs a few children at once, taking users in turn (see Sandbox below; CHECK_WORKERS).

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

/** The check could not start in time (too many checks queued); nothing is known about the song. */
export class SandboxBusyError extends Error {}
/** A newer check of the same kind from the same user replaced this one while it was still queued. */
export class SandboxSupersededError extends Error {}

/** Who asks, for fairness: checks are taken from users in turn, and each user's queue is capped. */
export interface CallOptions {
  /** User (tenant) id; checks without one share the bucket ''. */
  user?: string;
  /** Queued checks with the same user and key are dropped when a new one arrives (typing: only the latest matters). */
  supersede?: string;
}

/** Default number of children running checks at once in each pool: about half the cores, 1 to 3. */
export function defaultWorkers(env: NodeJS.ProcessEnv = process.env, cores = availableParallelism()): number {
  const n = Number(env.CHECK_WORKERS);
  if (Number.isInteger(n) && n >= 1 && n <= 64) return n;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/**
 * A small pool of sandbox children. Every request is served by a pre-spawned, already initialised child
 * that is used exactly once and then killed; replacement spares are spawned in the background.
 *
 * Fairness: up to `workers` checks run at once. Waiting checks sit in one queue per user, and a free
 * worker takes the oldest check of the user served longest ago (round robin), so a user with many (or hanging)
 * checks delays someone else by at most one check. One user runs at most `workers - 1` checks at once
 * (1 with a single worker), holds at most `maxQueuedPerUser` waiting checks (more are refused as busy),
 * and a check with a `supersede` key replaces that user's waiting check with the same key.
 *
 * Every check has a wall-clock budget from the moment it is queued (`maxTotalMs`): a check still waiting
 * or running when it runs out is stopped (its child killed) with SandboxBusyError, so callers always get
 * an answer before their own timeout. The per-operation limit that marks a song as hanging
 * (SandboxTimeoutError) only counts the time the song itself runs.
 */
export interface SandboxOptions {
  /** RSS probe (tests inject one). */
  readRss?: (pid: number) => Promise<number | null>;
  pollMs?: number;
  /** Children running checks at once (default defaultWorkers()). */
  workers?: number;
  /** Waiting checks per user (default 4). */
  maxQueuedPerUser?: number;
  /** Wall-clock budget per check from being queued to its answer (default 40 s). */
  maxTotalMs?: number;
  /** Per-operation run limit (default opTimeout: 3 s precheck, HARD_TIMEOUT_MS otherwise). */
  opTimeoutMs?: number;
}

interface Job {
  req: Op;
  user: string;
  supersede?: string;
  resolve(v: unknown): void;
  reject(e: Error): void;
  /** Set while running: stops the check (kills its child) with the given error. */
  abort?: (e: Error) => void;
  done: boolean;
  deadline: ReturnType<typeof setTimeout>;
}

export class Sandbox {
  readonly workers: number;
  private readonly maxQueuedPerUser: number;
  private readonly maxTotalMs: number;
  constructor(private readonly opts: SandboxOptions = {}) {
    this.workers = Math.max(1, opts.workers ?? defaultWorkers());
    this.maxQueuedPerUser = Math.max(1, opts.maxQueuedPerUser ?? 4);
    this.maxTotalMs = opts.maxTotalMs ?? 40_000;
  }
  private spares: Promise<Child>[] = [];
  private live = new Set<ChildProcess>();
  /** Waiting checks per user. */
  private waiting = new Map<string, Job[]>();
  /** When each user last had a check started (a serial number): the next turn goes to the smallest. */
  private served = new Map<string, number>();
  private serial = 0;
  private runningPer = new Map<string, number>();
  private running = 0;

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
    const dropSpare = () => { this.spares = this.spares.filter((s) => s !== ready); };
    proc.once('exit', () => {
      this.live.delete(proc);
      dropSpare(); // a spare that died while idle is replaced on demand
    });
    ready.catch(dropSpare);
    // never keep the server (or a test worker) alive just for the sandbox
    proc.unref();
    (proc as any).channel?.unref?.();
    return ready;
  }

  /** Start spares (one per worker) so the next requests do not wait for a child to start. */
  prewarm() {
    while (this.spares.length < this.workers) this.spares.push(this.spawn());
  }

  private async take(): Promise<Child> {
    const spare = this.spares.shift() ?? this.spawn();
    this.prewarm(); // the replacement starts while this request runs
    const child = await spare.catch(() => this.spawn()); // a spare that failed to start gets one retry
    return child.proc.connected ? child : this.spawn();
  }

  kill() {
    const spares = this.spares;
    this.spares = [];
    for (const s of spares) s.catch(() => undefined);
    for (const proc of this.live) proc.kill('SIGKILL');
    this.live.clear();
    for (const jobs of this.waiting.values()) for (const j of jobs) this.settle(j, () => j.reject(new SandboxBusyError('the check service stopped')));
    this.waiting.clear();
  }

  /** Checks waiting (not running) for a user; for tests and diagnostics. */
  queued(user = ''): number {
    return this.waiting.get(user)?.length ?? 0;
  }

  call<T>(req: Op, opts: CallOptions = {}): Promise<T> {
    const user = opts.user ?? '';
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        req, user, supersede: opts.supersede, resolve: resolve as (v: unknown) => void, reject, done: false,
        deadline: setTimeout(() => {
          const e = new SandboxBusyError(`the check did not finish within ${this.maxTotalMs / 1000} s (too many checks at once); try again`);
          if (job.abort) job.abort(e); // running: its child is killed
          else this.unqueue(job);
          this.settle(job, () => reject(e));
        }, this.maxTotalMs),
      };
      job.deadline.unref?.();
      const queue = this.waiting.get(user) ?? [];
      if (job.supersede !== undefined) {
        for (const old of queue.filter((j) => j.supersede === job.supersede)) {
          this.unqueue(old);
          this.settle(old, () => old.reject(new SandboxSupersededError('replaced by a newer check')));
        }
      }
      const q = this.waiting.get(user) ?? [];
      if (q.length >= this.maxQueuedPerUser) {
        this.settle(job, () => reject(new SandboxBusyError(`too many checks waiting (${this.maxQueuedPerUser}); try again in a moment`)));
        return;
      }
      q.push(job);
      this.waiting.set(user, q);
      this.pump();
    });
  }

  private settle(job: Job, fn: () => void) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.deadline);
    fn();
  }

  private unqueue(job: Job) {
    const q = this.waiting.get(job.user);
    if (!q) return;
    const i = q.indexOf(job);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) { this.waiting.delete(job.user); this.forget(job.user); }
  }

  private perUserCap() { return Math.max(1, this.workers - 1); }

  /** Starts waiting checks while workers are free: the user served longest ago first, each user's oldest check first. */
  private pump() {
    while (this.running < this.workers) {
      let pick: string | undefined;
      for (const user of this.waiting.keys()) {
        if ((this.runningPer.get(user) ?? 0) >= this.perUserCap()) continue;
        if (pick === undefined || (this.served.get(user) ?? 0) < (this.served.get(pick) ?? 0)) pick = user;
      }
      if (pick === undefined) return;
      const q = this.waiting.get(pick)!;
      const job = q.shift()!;
      if (!q.length) this.waiting.delete(pick);
      this.start(job);
    }
  }

  /** Forgets a user's turn once nothing of theirs waits or runs. */
  private forget(user: string) {
    if (!this.waiting.has(user) && !this.runningPer.has(user)) this.served.delete(user);
  }

  private start(job: Job) {
    this.running++;
    this.runningPer.set(job.user, (this.runningPer.get(job.user) ?? 0) + 1);
    this.served.set(job.user, ++this.serial);
    const release = () => {
      this.running--;
      const n = (this.runningPer.get(job.user) ?? 1) - 1;
      if (n > 0) this.runningPer.set(job.user, n); else this.runningPer.delete(job.user);
      this.forget(job.user);
      this.pump();
    };
    this.dispatch(job).then(
      (v) => this.settle(job, () => job.resolve(v)),
      (e) => this.settle(job, () => job.reject(e)),
    ).finally(release);
  }

  private async dispatch(job: Job): Promise<unknown> {
    const req = job.req;
    // stopped while its child was starting: the child is still taken (and killed) so nothing leaks
    let aborted: Error | null = null;
    job.abort = (e) => { aborted = e; };
    const { proc, stderr } = await this.take();
    if (aborted) { proc.kill('SIGKILL'); throw aborted; }
    const limitMs = this.opts.opTimeoutMs ?? opTimeout(req.op);
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
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
      job.abort = (e) => finish(() => reject(e));
      const timer = setTimeout(() => {
        finish(() => reject(new SandboxTimeoutError(`evaluation timed out after ${limitMs / 1000} s (endless loop or far too much work?)`)));
      }, limitMs);
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
        finish(() => (m.ok ? resolve(m.result) : reject(new Error(String(m.error)))));
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

/** Song checks (inspect, events) for the editor and the assistant. Its answer budget stays under the platform's 45 s. */
const sandbox = new Sandbox({ maxTotalMs: 30_000 });
/**
 * Pre-flight checks get their own children, so they never wait behind a slow inspect. The platform waits
 * 10 s for an answer: 8 s from queued to answered, of which the song itself may run 3 s.
 */
const precheckSandbox = new Sandbox({ maxTotalMs: 8_000 });

export function sandboxAnalyse(code: string, opts: CallOptions = {}): Promise<Analysis> {
  return sandbox.call<Analysis>({ op: 'inspect', args: { code } }, opts);
}

export function sandboxPrecheck(code: string, opts: CallOptions = {}): Promise<PrecheckResult> {
  return precheckSandbox.call<PrecheckResult>({ op: 'precheck', args: { code } }, opts);
}

export function sandboxQuery(code: string, fromCycle: number, toCycle: number, sound?: string, limit?: number, opts: CallOptions = {}): Promise<QueryResult> {
  return sandbox.call<QueryResult>({ op: 'query', args: { code, fromCycle, toCycle, sound, limit } }, opts);
}

/** Spawn the warm spares ahead of the first requests (called at server start). */
export function prewarmSandbox() {
  sandbox.prewarm();
  precheckSandbox.prewarm();
}

/** Test hook: stop every sandbox process (the spare included). */
export function stopSandbox() {
  sandbox.kill();
  precheckSandbox.kill();
}

// Sandbox child prelude (loaded with --import by ../sandbox.ts, never by the server itself).
// The permission model already blocks fs writes, child processes, workers and addons; this closes
// what it does not cover, before any user code runs:
//  - built-in modules: only an (empty) allowlist of node: built-ins can be imported, required or
//    fetched via process.getBuiltinModule; process.binding is disabled; network globals are removed;
//  - signals and process control: process.kill / exit / chdir / dlopen / ... throw;
//  - runaway timers: every timer, immediate and message port created by evaluated code is tracked
//    and torn down by endOp() when an inspect/query finishes.
import module from 'node:module';
import timers from 'node:timers';

const denied = (what) => {
  const err = new Error(`${what} is not available in the evaluation sandbox`);
  err.code = 'ERR_ACCESS_DENIED';
  return err;
};

// ---- built-in modules -------------------------------------------------------------------------
// ALLOWLIST, not a denylist: a built-in is importable only if listed here. The list is what the Strudel
// packages actually resolve in this child, determined empirically by logging every node: built-in that
// reached the resolve hook or process.getBuiltinModule while inspecting and querying the catdance,
// no-arrange and double-quotes fixtures (Strudel 1.2.6, Node 22.23): NONE. The child's own trusted
// modules (this file: node:module, node:timers) are imported before the hooks below are installed.
// Every other built-in (fs, net, http, child_process, worker_threads, vm, module, ...), with or without
// the node: prefix, is refused on all three paths: import / import() (resolve + load hooks), require()
// and createRequire() (module.registerHooks hooks apply to the CommonJS loader too), and
// process.getBuiltinModule().
export const ALLOWED_BUILTINS = new Set([]);

const bareId = (id) => String(id).replace(/^node:/, '');
const isBuiltinId = (id) => {
  const s = String(id);
  return s.startsWith('node:') || module.isBuiltin(s);
};
/** True for a built-in module specifier that is not on the allowlist. */
export const isBlockedModule = (id) => isBuiltinId(id) && !ALLOWED_BUILTINS.has(bareId(id));
const isBlockedUrl = (url) => typeof url === 'string' && url.startsWith('node:') && isBlockedModule(url);

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBlockedModule(specifier)) throw denied(`module "${specifier}"`);
    const result = nextResolve(specifier, context);
    if (isBlockedUrl(result?.url)) throw denied(`module "${specifier}"`);
    return result;
  },
  load(url, context, nextLoad) {
    if (isBlockedUrl(url)) throw denied(`module "${url}"`);
    return nextLoad(url, context);
  },
});

// ---- process ----------------------------------------------------------------------------------
const lock = (obj, key, value) => Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: false });

const originalGetBuiltin = process.getBuiltinModule?.bind(process);
if (originalGetBuiltin) {
  lock(process, 'getBuiltinModule', (id) => {
    if (!ALLOWED_BUILTINS.has(bareId(id))) throw denied(`module "${id}"`);
    return originalGetBuiltin(id);
  });
}

const reallyExit = process.reallyExit.bind(process);
/** Exit for the child's own use (the public process.exit is disabled below). */
export const exitChild = (code = 0) => reallyExit(code);

for (const name of ['binding', '_linkedBinding', 'dlopen', 'kill', 'exit', 'reallyExit', 'abort', 'chdir', 'umask',
  'setuid', 'setgid', 'seteuid', 'setegid', 'setgroups', 'initgroups', '_kill', '_debugProcess', '_debugEnd', '_startProfilerIdleNotifier']) {
  if (name in process) lock(process, name, () => { throw denied(`process.${name}`); });
}

// ---- network globals --------------------------------------------------------------------------
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  delete globalThis[name];
  lock(globalThis, name, undefined);
}
if (globalThis.navigator && 'sendBeacon' in globalThis.navigator) {
  try { delete globalThis.navigator.sendBeacon; } catch { /* non-configurable */ }
}

// ---- timers and message ports -----------------------------------------------------------------
const live = { timeouts: new Set(), intervals: new Set(), immediates: new Set(), ports: new Set() };
const { setTimeout: st, setInterval: si, setImmediate: sim, clearTimeout: ct, clearInterval: ci, clearImmediate: cim } = timers;

function wrapOnce(set, schedule) {
  return (fn, ...rest) => {
    let handle;
    const cb = typeof fn === 'function' ? (...a) => { set.delete(handle); return fn(...a); } : fn;
    handle = schedule(cb, ...rest);
    set.add(handle);
    return handle;
  };
}
const wrapped = {
  setTimeout: wrapOnce(live.timeouts, st),
  setImmediate: wrapOnce(live.immediates, sim),
  setInterval: (...args) => { const h = si(...args); live.intervals.add(h); return h; },
  clearTimeout: (h) => { live.timeouts.delete(h); return ct(h); },
  clearInterval: (h) => { live.intervals.delete(h); return ci(h); },
  clearImmediate: (h) => { live.immediates.delete(h); return cim(h); },
};
for (const [name, fn] of Object.entries(wrapped)) {
  Object.defineProperty(fn, 'name', { value: name });
  lock(globalThis, name, fn);
  timers[name] = fn;
}
module.syncBuiltinESMExports();

const OrigMessageChannel = globalThis.MessageChannel;
const OrigBroadcastChannel = globalThis.BroadcastChannel;
if (OrigMessageChannel) {
  lock(globalThis, 'MessageChannel', class MessageChannel extends OrigMessageChannel {
    constructor() { super(); live.ports.add(this.port1); live.ports.add(this.port2); }
  });
}
if (OrigBroadcastChannel) {
  lock(globalThis, 'BroadcastChannel', class BroadcastChannel extends OrigBroadcastChannel {
    constructor(name) { super(name); live.ports.add(this); }
  });
}

/** Tear down everything evaluated code scheduled during the operation that just finished. */
export function endOp() {
  for (const h of live.timeouts) ct(h);
  for (const h of live.intervals) ci(h);
  for (const h of live.immediates) cim(h);
  for (const p of live.ports) { try { p.close(); } catch { /* already closed */ } }
  live.timeouts.clear();
  live.intervals.clear();
  live.immediates.clear();
  live.ports.clear();
}

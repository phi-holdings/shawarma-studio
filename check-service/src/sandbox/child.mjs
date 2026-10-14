// Sandbox child: evaluates untrusted Strudel code. Spawned by ../sandbox.ts with the Node permission
// model (read-only access to node_modules + server/src, no fs writes, no child processes) and an
// empty environment, so evaluated code can reach neither secrets nor the filesystem.
// harden.mjs is also preloaded with --import (before Strudel loads); importing it here reuses that
// instance and gives the child its own exit and the per-operation timer teardown.
//
// One child serves exactly ONE operation: it is spawned ahead of time as a warm spare (Strudel loaded,
// scope initialised, parser/query code warmed up), handles the first request it receives, replies and
// exits; the parent SIGKILLs it as soon as the reply arrives. Nothing a song does (globals, removed
// listeners, timers, microtask loops, forged IPC messages) can outlive its own operation.
import { endOp, exitChild } from './harden.mjs';
import { analyse, precheck, queryRows, warmup } from './core.mjs';

if (!process.send) throw new Error('child.mjs must be spawned with an IPC channel');
const send = process.send.bind(process);
process.on('disconnect', () => exitChild(0));

let used = false;
process.on('message', async (msg) => {
  if (used) return; // single use: later messages are ignored (the parent never sends any)
  used = true;
  const { id, op, args } = msg ?? {};
  const startedAt = Date.now();
  let reply;
  try {
    let result;
    if (op === 'inspect') result = await analyse(args.code, startedAt);
    else if (op === 'query') result = await queryRows(args.code, args.fromCycle, args.toCycle, args.sound, args.limit, startedAt);
    else if (op === 'precheck') result = await precheck(args.code, startedAt);
    else if (op === 'ping') result = 'pong';
    else throw new Error(`unknown op ${op}`);
    reply = { id, ok: true, result };
  } catch (e) {
    reply = { id, ok: false, error: String(e?.message ?? e) };
  } finally {
    // timers/intervals/immediates/ports the song code started must not fire before the parent kills us
    endOp();
  }
  send(reply, () => exitChild(0));
});

try {
  await warmup();
  send({ ready: true });
} catch (e) {
  process.stderr.write(`sandbox warmup failed: ${e?.stack ?? e}\n`);
  exitChild(1);
}

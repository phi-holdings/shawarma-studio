import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { inspect, queryEvents } from './inspect';
import { SandboxMemoryError, SandboxTimeoutError, sandboxPrecheck } from './sandbox';
import { knownSounds } from './sounds';

// The check service: the only process that loads Strudel. The platform server calls it over loopback HTTP
// (server/src/check/client.ts). Song code only ever runs in the sandbox children (see sandbox.ts).
//   POST /inspect   {code, extraSounds?}                      -> InspectReport
//   POST /events    {code, fromCycle, toCycle, sound?}        -> EventQuery
//   POST /precheck  {code}                                    -> {ok, ...} | {ok:false, hang:true, error}
//   GET  /sounds                                              -> {sounds: string[] | null}
//   GET  /health                                              -> {ok: true}
// With CHECK_KEY set, every route but /health needs the same value in the x-check-key header.

const MAX_BODY_BYTES = 1024 * 1024;

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createCheckApp(opts: { key?: string } = {}) {
  const key = opts.key?.trim() || undefined;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    if (key && !sameKey(c.req.header('x-check-key') ?? '', key)) return c.json({ error: 'forbidden' }, 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'body too large' }, 413) }));

  const read = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
    let b: unknown;
    try { b = await c.req.json(); } catch { throw new BadRequest('body must be JSON'); }
    if (!b || typeof b !== 'object') throw new BadRequest('body must be a JSON object');
    if (typeof (b as { code?: unknown }).code !== 'string') throw new BadRequest('code must be a string');
    return b as Record<string, unknown>;
  };

  app.post('/inspect', async (c) => {
    const b = await read(c);
    const extra = b.extraSounds;
    if (extra !== undefined && (!Array.isArray(extra) || extra.some((s) => typeof s !== 'string'))) throw new BadRequest('extraSounds must be an array of strings');
    return c.json(await inspect(b.code as string, { extraSounds: extra as string[] | undefined }));
  });

  app.post('/events', async (c) => {
    const b = await read(c);
    const { fromCycle, toCycle, sound } = b;
    if (typeof fromCycle !== 'number' || typeof toCycle !== 'number' || !Number.isFinite(fromCycle) || !Number.isFinite(toCycle)) throw new BadRequest('fromCycle and toCycle must be finite numbers');
    if (sound !== undefined && typeof sound !== 'string') throw new BadRequest('sound must be a string');
    return c.json(await queryEvents(b.code as string, fromCycle, toCycle, sound));
  });

  app.post('/precheck', async (c) => {
    const b = await read(c);
    try {
      return c.json({ ok: true, ...(await sandboxPrecheck(b.code as string)) });
    } catch (e) {
      if (e instanceof SandboxTimeoutError || e instanceof SandboxMemoryError) return c.json({ ok: false, hang: true, error: e.message });
      return c.json({ ok: true, error: (e as Error).message });
    }
  });

  app.get('/sounds', async (c) => {
    const s = await knownSounds();
    return c.json({ sounds: s ? [...s] : null });
  });

  app.onError((e, c) => {
    if (e instanceof BadRequest) return c.json({ error: e.message }, 400);
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}

class BadRequest extends Error {}

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { inspect, queryEvents } from './inspect';
import { SandboxMemoryError, SandboxTimeoutError, sandboxPrecheck } from './sandbox';
import { shippedReference } from './reference/search';
import type { ReferenceKind } from './reference/types';
import { knownSounds } from './sounds';

// The check service: the only process that loads Strudel. The platform server calls it over loopback HTTP
// (server/src/check/client.ts). Song code only ever runs in the sandbox children (see sandbox.ts).
//   POST /inspect   {code, extraSounds?}                      -> InspectReport
//   POST /events    {code, fromCycle, toCycle, sound?}        -> EventQuery
//   POST /precheck  {code}                                    -> {ok, ...} | {ok:false, hang:true, error}
//   GET  /sounds                                              -> {sounds: string[] | null}
//   GET  /reference?q=&limit=5&kinds=function,doc            -> {results: [{kind,title,source,content,why,ref}]}
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

  app.get('/reference', (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) throw new BadRequest('q must be a non-empty string');
    const limit = c.req.query('limit') === undefined ? 5 : Number(c.req.query('limit'));
    if (!Number.isFinite(limit) || limit < 1) throw new BadRequest('limit must be a number from 1 to 10');
    const kinds = c.req.query('kinds')?.split(',').map((k) => k.trim()).filter(Boolean) ?? [];
    if (kinds.some((k) => k !== 'function' && k !== 'doc')) throw new BadRequest('kinds must be function and/or doc');
    const results = shippedReference().search(q.slice(0, 500), { limit, kinds: kinds as ReferenceKind[] });
    return c.json({ results: results.map(({ kind, title, source, content, why, ref }) => ({ kind, title, source, content, why, ref })) });
  });

  app.onError((e, c) => {
    if (e instanceof BadRequest) return c.json({ error: e.message }, 400);
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}

class BadRequest extends Error {}

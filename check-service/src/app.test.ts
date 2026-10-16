import { afterAll, expect, test } from 'vitest';
import { createCheckApp } from './app';
import { defaultWorkers, stopSandbox } from './sandbox';

afterAll(() => stopSandbox());

const post = (app: ReturnType<typeof createCheckApp>, route: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('inspect, events and precheck over HTTP', async () => {
  const app = createCheckApp();
  const r = await (await post(app, '/inspect', { code: 's("bd sd")', extraSounds: ['mine'] })).json();
  expect(r.ok).toBe(true);
  const q = await (await post(app, '/events', { code: 'note("c4 e4").s("sine")', fromCycle: 0, toCycle: 1 })).json();
  expect(q.events.length).toBe(2);
  expect(await (await post(app, '/precheck', { code: 's("bd")' })).json()).toMatchObject({ ok: true });
  expect(await (await post(app, '/precheck', { code: 'while (true) {}\ns("bd")' })).json()).toMatchObject({ ok: false, hang: true });
});

test('the key is required when set (health is open); bad bodies are JSON errors', async () => {
  const app = createCheckApp({ key: 'k' });
  expect((await app.request('/health')).status).toBe(200);
  expect((await post(app, '/inspect', { code: 's("bd")' })).status).toBe(403);
  expect((await post(app, '/inspect', { code: 5 }, { 'x-check-key': 'k' })).status).toBe(400);
  const big = await post(app, '/inspect', { code: 'x'.repeat(2 * 1024 * 1024) }, { 'x-check-key': 'k' });
  expect(big.status).toBe(413);
  expect(await big.json()).toEqual({ error: 'body too large' });
});

test('a waiting check replaced by a newer one from the same user answers 409 superseded; a full queue 503 busy', async () => {
  const app = createCheckApp();
  const x = { 'x-check-user': 'x' };
  // fill every worker x may use (all but one) with hanging songs, so x's next checks wait
  const hangs = Array.from({ length: Math.max(1, defaultWorkers() - 1) }, () => post(app, '/precheck', { code: 'while (true) {}\ns("bd")' }, x));
  await new Promise((r) => setTimeout(r, 100));
  const first = post(app, '/precheck', { code: 's("a")' }, { ...x, 'x-check-supersede': 'play' });
  await new Promise((r) => setTimeout(r, 20));
  const second = post(app, '/precheck', { code: 's("b")' }, { ...x, 'x-check-supersede': 'play' });
  const old = await first;
  expect(old.status).toBe(409);
  expect(await old.json()).toMatchObject({ code: 'superseded' });
  expect((await second).status).toBe(200);
  // another user is served meanwhile
  expect(await (await post(app, '/precheck', { code: 's("y")' }, { 'x-check-user': 'y' })).json()).toMatchObject({ ok: true });
  for (const h of await Promise.all(hangs)) expect(await h.json()).toMatchObject({ ok: false, hang: true });
  // more than 4 waiting checks from one user: busy
  const many = [...Array.from({ length: Math.max(1, defaultWorkers() - 1) + 4 }, () => post(app, '/inspect', { code: 'while (true) {}\ns("bd")' }, x))];
  const extra = await post(app, '/inspect', { code: 's("bd")' }, x);
  expect(extra.status).toBe(503);
  expect(await extra.json()).toMatchObject({ code: 'busy' });
  stopSandbox();
  await Promise.allSettled(many);
}, 60_000);

import { afterAll, expect, test } from 'vitest';
import { createCheckApp } from './app';
import { stopSandbox } from './sandbox';

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

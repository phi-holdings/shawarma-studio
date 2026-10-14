import { afterEach, expect, test, vi } from 'vitest';
import { OfflineError, chatReady, createProject, getProject, getSettings, postAnalysis, removeApiKey, saveApiKey, setDailyCap, streamChat } from './api';

const mock = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
afterEach(() => vi.unstubAllGlobals());
const chatBody = { code: '', selection: null, message: 'hi', deep: false };

test('streamChat surfaces the server JSON error on 409', async () => {
  mock(async () => new Response(JSON.stringify({ error: 'a chat is already running for this project' }), { status: 409 }));
  await expect(streamChat('p', chatBody, () => {})).rejects.toThrow('a chat is already running for this project');
});

test('streamChat maps an empty 500 to OfflineError', async () => {
  mock(async () => new Response('', { status: 500 }));
  await expect(streamChat('p', chatBody, () => {})).rejects.toBeInstanceOf(OfflineError);
});

test('streamChat maps network failure to OfflineError', async () => {
  mock(async () => { throw new TypeError('Failed to fetch'); });
  await expect(streamChat('p', chatBody, () => {})).rejects.toMatchObject({ name: 'OfflineError', message: 'offline' });
});

test('500 with a JSON error stays a regular error', async () => {
  mock(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
  const err = await getProject('p').catch((e) => e);
  expect(err).not.toBeInstanceOf(OfflineError);
  expect(err.message).toBe('boom');
});

test('createProject 409 message is readable', async () => {
  mock(async () => new Response(JSON.stringify({ error: 'project exists' }), { status: 409 }));
  await expect(createProject('x')).rejects.toThrow('project exists');
});

test('streamChat parses SSE events', async () => {
  mock(async () => new Response('data: {"type":"text","delta":"a"}\n\ndata: {"type":"done","costUsd":0}\n\n', { status: 200 }));
  const seen: string[] = [];
  await streamChat('p', chatBody, (e) => seen.push(e.type));
  expect(seen).toEqual(['text', 'done']);
});

test('postAnalysis throws the server error on a non-OK response', async () => {
  mock(async () => new Response(JSON.stringify({ error: 'invalid analysis body' }), { status: 400 }));
  await expect(postAnalysis('r1', { error: 'x' })).rejects.toThrow('invalid analysis body');
});

test('postAnalysis resolves on OK', async () => {
  mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await expect(postAnalysis('r1', { error: 'x' })).resolves.toEqual({ ok: true });
});

const SETTINGS = { hasKey: true, keyHint: '…abcd', dailyCapUsd: 5, spentTodayUsd: 0.12, fakeAi: false };
const capture = (res: () => Response) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return res(); }));
  return calls;
};

test('getSettings reads /api/settings', async () => {
  const calls = capture(() => new Response(JSON.stringify(SETTINGS)));
  await expect(getSettings()).resolves.toEqual(SETTINGS);
  expect(calls[0].url).toBe('/api/settings');
});

test('saveApiKey PUTs the key as JSON and returns the settings', async () => {
  const calls = capture(() => new Response(JSON.stringify(SETTINGS)));
  await expect(saveApiKey('sk-ant-x')).resolves.toEqual(SETTINGS);
  expect(calls[0].url).toBe('/api/settings/key');
  expect(calls[0].init?.method).toBe('PUT');
  expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ key: 'sk-ant-x' });
});

test('saveApiKey surfaces the server message when the key is refused', async () => {
  capture(() => new Response(JSON.stringify({ error: 'Anthropic rejected the key: invalid x-api-key' }), { status: 400 }));
  await expect(saveApiKey('sk-ant-x')).rejects.toThrow('Anthropic rejected the key: invalid x-api-key');
});

test('removeApiKey DELETEs the key; setDailyCap PUTs the cap', async () => {
  const calls = capture(() => new Response(JSON.stringify(SETTINGS)));
  await removeApiKey();
  await setDailyCap(2.5);
  expect([calls[0].url, calls[0].init?.method]).toEqual(['/api/settings/key', 'DELETE']);
  expect([calls[1].url, calls[1].init?.method]).toEqual(['/api/settings', 'PUT']);
  expect(JSON.parse(String(calls[1].init?.body))).toEqual({ dailyCapUsd: 2.5 });
});

test('the API key is never written to localStorage or sessionStorage', async () => {
  const writes: string[] = [];
  const storage = { setItem: (k: string, v: string) => writes.push(k, v), getItem: () => null, removeItem() {}, clear() {}, key: () => null, length: 0 };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  capture(() => new Response(JSON.stringify(SETTINGS)));
  await saveApiKey('sk-ant-secret');
  expect(writes).toEqual([]);
});

test('chatReady needs a stored key unless the server runs fake AI', () => {
  expect(chatReady(null)).toBe(false);
  expect(chatReady({ ...SETTINGS, hasKey: false })).toBe(false);
  expect(chatReady({ ...SETTINGS, hasKey: false, fakeAi: true })).toBe(true);
  expect(chatReady(SETTINGS)).toBe(true);
});

test('export upload streams interleaved float32 in offset-checked PUTs, then finishes with format + small flag', async () => {
  const { startExportUpload, UPLOAD_CHUNK_BYTES } = await import('./api');
  const calls: { url: string; method?: string; size: number; body?: string }[] = [];
  let stored = 0;
  let firstBytes: Uint8Array | null = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const bytes = init.body as Uint8Array;
      firstBytes ??= bytes.slice(0, 16);
      calls.push({ url, method: 'PUT', size: bytes.length });
      stored += bytes.length;
      return new Response(JSON.stringify({ size: stored }));
    }
    calls.push({ url, method: init?.method, size: 0, body: String(init?.body) });
    if (url.endsWith('/start')) return new Response(JSON.stringify({ uploadId: 'u1' }));
    return new Response(JSON.stringify({ wav: 'a.wav', mp3: 'a.mp3', peakDb: -1 }));
  }));
  const up = await startExportUpload('p', 'song');
  expect(up.uploadId).toBe('u1');
  const frames = 3 * 1024 * 1024;                       // 24 MB of stereo float32: two PUTs
  const l = new Float32Array(frames), r = new Float32Array(frames);
  l[0] = 0.5; r[0] = -0.25; l[1] = 1;
  await up.push([l, r]);
  await up.push([new Float32Array(10), new Float32Array(10)]);
  const res = await up.finish({ sampleRate: 48000, channels: 2, small: true });
  expect(calls.map((c) => c.url)).toEqual([
    '/api/projects/p/exports/start',
    '/api/projects/p/exports/u1/f32?offset=0',
    `/api/projects/p/exports/u1/f32?offset=${UPLOAD_CHUNK_BYTES}`,
    `/api/projects/p/exports/u1/f32?offset=${frames * 8}`,
    '/api/projects/p/exports/u1/finish',
  ]);
  expect(JSON.parse(calls[0].body!)).toEqual({ name: 'song' });
  expect(calls[1].size % 8).toBe(0);                     // never splits a frame
  expect([...new Float32Array(firstBytes!.buffer, firstBytes!.byteOffset, 3)]).toEqual([0.5, -0.25, 1]); // interleaved L R L
  expect(JSON.parse(calls[4].body!)).toEqual({ format: 'f32', sampleRate: 48000, channels: 2, small: true });
  expect(res.peakDb).toBe(-1);
});

test('export upload stops when the server reports a different size; abort deletes the partial upload', async () => {
  const { startExportUpload } = await import('./api');
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method} ${url}`);
    return new Response(JSON.stringify(url.endsWith('/start') ? { uploadId: 'abc' } : { size: 3 }));
  }));
  const up = await startExportUpload('p', 'song');
  await expect(up.push([new Float32Array(10)])).rejects.toThrow(/out of sync/);
  await up.abort();
  expect(seen.at(-1)).toBe('DELETE /api/projects/p/exports/abc');
});

test('a refused export start (busy, disk full) surfaces the server message', async () => {
  const { startExportUpload } = await import('./api');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'too many exports running; wait for one to finish' }), { status: 429 })));
  await expect(startExportUpload('p', 'song')).rejects.toThrow(/too many exports/);
});

test('without a name the export start lets the server derive one', async () => {
  const { startExportUpload } = await import('./api');
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { bodies.push(String(init?.body)); return new Response(JSON.stringify({ uploadId: 'u' })); }));
  await startExportUpload('My Song');
  expect(bodies).toEqual(['{}']);
});

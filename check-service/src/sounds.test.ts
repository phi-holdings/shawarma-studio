import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('sample-map fetches have a timeout; a failed fetch skips the list instead of throwing and is retried', async () => {
  vi.stubEnv('SHAWARMA_CACHE_DIR', await fs.mkdtemp(path.join(os.tmpdir(), 'snd-')));
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  vi.stubGlobal('fetch', fetchMock);
  const { knownSounds } = await import('./sounds');
  expect(await knownSounds()).toBeNull();
  const calls = fetchMock.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  expect(await knownSounds()).toBeNull();
  expect(fetchMock.mock.calls.length).toBe(calls * 2); // not cached: retried
});

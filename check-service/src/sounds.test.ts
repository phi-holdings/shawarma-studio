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

/** A fetch that serves the given sample maps by file name. */
function serveMaps(maps: Record<string, Record<string, unknown>>) {
  return vi.fn(async (url: string) => {
    const file = url.slice(url.lastIndexOf('/') + 1);
    return file in maps ? new Response(JSON.stringify(maps[file])) : new Response('not found', { status: 404 });
  });
}

const MAPS = {
  'piano.json': { _base: 'x/', piano: { a0: 'A0v8.mp3' } },
  'vcsl.json': { darbuka: ['d/1.wav'] },
  'tidal-drum-machines.json': { rolandtr909_bd: ['909/bd.wav'] },
  'uzu-drumkit.json': { bd: ['bd/1.wav'], hh: ['hh/1.wav'] },
  'uzu-wavetables.json': { wt_digital: ['wt/1.wav'] },
  'mridangam.json': { mridangam_ta: ['ta/1.wav'] },
};

test('hosted packs: no drum machines, wavetables or Dirt sounds; local mode knows them all', async () => {
  vi.stubEnv('SHAWARMA_CACHE_DIR', await fs.mkdtemp(path.join(os.tmpdir(), 'snd-')));
  const fetchMock = serveMaps(MAPS);
  vi.stubGlobal('fetch', fetchMock);
  const { knownSounds } = await import('./sounds');
  const hosted = (await knownSounds('hosted'))!;
  for (const n of ['bd', 'hh', 'piano', 'darbuka', 'mridangam_ta', 'gm_piano', 'sawtooth']) expect(hosted.has(n), n).toBe(true);
  for (const n of ['rolandtr909_bd', 'wt_digital', 'casio', 'jazz']) expect(hosted.has(n), n).toBe(false);
  expect(fetchMock.mock.calls.map(([u]) => String(u).split('/').pop()).sort()).toEqual(['mridangam.json', 'piano.json', 'uzu-drumkit.json', 'vcsl.json']);
  const all = (await knownSounds('all'))!;
  for (const n of ['rolandtr909_bd', 'wt_digital', 'casio', 'bd', 'mridangam_ta']) expect(all.has(n), n).toBe(true);
});

test('SOUND_PACKS sets the default pack set; an unknown value stops the service', async () => {
  vi.stubEnv('SOUND_PACKS', 'hosted');
  expect((await import('./config')).SOUND_PACK_SET).toBe('hosted');
  vi.resetModules();
  vi.stubEnv('SOUND_PACKS', 'everything');
  await expect(import('./config')).rejects.toThrow(/SOUND_PACKS must be hosted or all/);
});

import { beforeEach, expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ samples: [] as string[], aliasBank: [] as string[] }));
vi.mock('@strudel/webaudio', () => ({
  registerSynthSounds: async () => {},
  registerZZFXSounds: async () => {},
  samples: async (map: string) => { calls.samples.push(map); },
  aliasBank: async (url: string) => { calls.aliasBank.push(url); },
}));
vi.mock('@strudel/soundfonts', () => ({ registerSoundfonts: async () => {} }));
vi.mock('@strudel/core', () => ({ evalScope: async () => {} }));

beforeEach(() => { calls.samples = []; calls.aliasBank = []; });

const file = (u: string) => u.slice(u.lastIndexOf('/') + 1);

test('hosted: only the cleanly licensed sample packs, no drum-machine aliases', async () => {
  const { prebake } = await import('./setup');
  await prebake('hosted');
  expect(calls.samples.map(file)).toEqual(['piano.json', 'vcsl.json', 'uzu-drumkit.json', 'mridangam.json']);
  expect(calls.aliasBank).toEqual([]);
});

test('local mode: every pack and the drum-machine aliases, as before', async () => {
  const { prebake } = await import('./setup');
  await prebake();
  expect(calls.samples.map(file)).toEqual(['piano.json', 'vcsl.json', 'tidal-drum-machines.json', 'uzu-drumkit.json', 'uzu-wavetables.json', 'mridangam.json']);
  expect(calls.samples.every((u) => u.startsWith('https://strudel.b-cdn.net/'))).toBe(true);
  expect(calls.aliasBank).toEqual(['https://strudel.b-cdn.net/tidal-drum-machines-alias.json']);
});

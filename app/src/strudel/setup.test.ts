import { beforeEach, expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ samples: [] as string[], bases: [] as string[], aliasBank: [] as string[], soundfontUrl: [] as string[] }));
vi.mock('@strudel/webaudio', () => ({
  registerSynthSounds: async () => {},
  registerZZFXSounds: async () => {},
  samples: async (map: string, base: string) => { calls.samples.push(map); calls.bases.push(base); },
  aliasBank: async (url: string) => { calls.aliasBank.push(url); },
}));
vi.mock('@strudel/soundfonts', () => ({ registerSoundfonts: async () => {}, setSoundfontUrl: (u: string) => { calls.soundfontUrl.push(u); } }));
vi.mock('@strudel/core', () => ({ evalScope: async () => {} }));

beforeEach(() => { calls.samples = []; calls.bases = []; calls.aliasBank = []; calls.soundfontUrl = []; });

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

test('hosted with self-hosted packs: maps, samples and GM soundfonts all from the packs URL', async () => {
  const { prebake } = await import('./setup');
  await prebake('hosted', 'https://shawarma.example/packs');
  expect(calls.samples).toEqual(['piano.json', 'vcsl.json', 'uzu-drumkit.json', 'mridangam.json'].map((m) => `https://shawarma.example/packs/${m}`));
  expect(calls.bases).toEqual(['piano', 'VCSL', 'uzu-drumkit', 'mrid'].map((f) => `https://shawarma.example/packs/${f}/`));
  expect(calls.soundfontUrl).toEqual(['https://shawarma.example/packs/gm']);
  // and without: Strudel's CDN and GitHub Pages, as before
  calls.soundfontUrl = [];
  await prebake('hosted');
  expect(calls.soundfontUrl).toEqual(['https://felixroos.github.io/webaudiofontdata/sound']);
});

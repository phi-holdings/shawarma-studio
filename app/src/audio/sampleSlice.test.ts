import { expect, test } from 'vitest';
import { MIN_PREROLL_SEC, ringsUntilSec } from './chunks';
import { sampleSliceLookup, scanWithSamples, type SampleDeps } from './sampleSlice';

/** Deps with a sample bank `gong` (6 s, at gong.wav) and `gone` (fails to load), loading on demand. */
function deps(loadable = new Set(['gong.wav'])): SampleDeps & { loads: string[] } {
  const loaded = new Map<string, { duration: number }>();
  const d = {
    loads: [] as string[],
    getSound: (s: string) => (['gong', 'gone'].includes(s) ? { data: { type: 'sample', samples: [`${s}.wav`] } } : s === 'saw' ? { data: { type: 'synth' } } : undefined),
    getSampleInfo: (v: Record<string, unknown>, bank: unknown) => ({ url: (bank as string[])[0], label: String(v.s), playbackRate: Math.abs(Number(v.speed ?? 1)) }),
    getLoadedBuffer: (url: string) => loaded.get(url),
    loadBuffer: async (url: string) => {
      d.loads.push(url);
      if (!loadable.has(url)) throw new Error('404');
      loaded.set(url, { duration: 6 });
    },
  };
  return d;
}
const hap = (value: object, begin = 0, end = 0.25) => ({ hasOnset: () => true, whole: { begin, end }, value });
const pat = (haps: any[]) => ({ queryArc: (a: number, b: number) => haps.filter((h) => h.whole.begin >= a && h.whole.begin < b) });

test('slice length: speed, begin/end; clip/loop/release and synths use the hap end', async () => {
  const d = deps();
  const misses = new Map<string, string>();
  const look = sampleSliceLookup(d, misses);
  expect(look({ s: 'gong' })).toBeNull();                      // not loaded yet: unknown
  expect([...misses.keys()]).toEqual(['gong.wav']);
  await d.loadBuffer('gong.wav', 'gong');
  expect(look({ s: 'gong' })).toBe(6);
  expect(look({ s: 'gong', speed: 0.25 })).toBe(24);
  expect(look({ s: 'gong', speed: -0.5, begin: 0.5, end: 1 })).toBe(6);
  expect(look({ s: 'gong', speed: 0 })).toBe(0);
  for (const v of [{ s: 'gong', clip: 1 }, { s: 'gong', loop: 1 }, { s: 'gong', release: 0.2 }, { s: 'saw' }, { s: 'nope' }, { note: 'c' }]) {
    expect(look(v as Record<string, unknown>), JSON.stringify(v)).toBeUndefined();
  }
});

test('unknown samples are loaded and the song rescanned; a failed load uses the hap end, never "ringing forever"', async () => {
  const d = deps();
  const song = pat([hap({ s: 'gong', speed: 0.25 }, 0), hap({ s: 'gone' }, 1, 1.25)]);
  const { grid, sliceSec } = await scanWithSamples(song, 0, 200, 1, { maxPrerollSec: 10 }, d);
  expect(d.loads.sort()).toEqual(['gone.wav', 'gong.wav']);
  // the gong rings 24 s + tail; the failed one only its hap
  expect(ringsUntilSec(hap({ s: 'gong', speed: 0.25 }, 0), 0, 1, sliceSec)).toBeCloseTo(24 + 0.01 + MIN_PREROLL_SEC, 9);
  expect(ringsUntilSec(hap({ s: 'gone' }, 1, 1.25), 0, 1, sliceSec)).toBeCloseTo(1.25 + 0.01 + MIN_PREROLL_SEC, 9);
  // so seams become quiet once the gong has rung out (not never, as for an unknown length)
  expect(grid.quiet[20]).toBe(0);
  expect([...grid.quiet.slice(33)].every(Boolean)).toBe(true);
});

test('a failed load only counts for that scan: the next export retries it, and a later successful load wins', async () => {
  const loadable = new Set(['gong.wav']);
  const d = deps(loadable);
  const song = pat([hap({ s: 'gone', speed: 0.25 }, 0)]);
  const first = await scanWithSamples(song, 0, 100, 1, { maxPrerollSec: 10 }, d);
  expect(ringsUntilSec(hap({ s: 'gone', speed: 0.25 }, 0), 0, 1, first.sliceSec)).toBeCloseTo(0.25 + 0.01 + MIN_PREROLL_SEC, 9);
  // the sample becomes available (network back): the next export loads it and uses its real length
  loadable.add('gone.wav');
  const second = await scanWithSamples(song, 0, 100, 1, { maxPrerollSec: 10 }, d);
  expect(d.loads.filter((u) => u === 'gone.wav')).toHaveLength(2);
  expect(ringsUntilSec(hap({ s: 'gone', speed: 0.25 }, 0), 0, 1, second.sliceSec)).toBeCloseTo(24 + 0.01 + MIN_PREROLL_SEC, 9);
  // within one lookup, a buffer that is loaded wins over an earlier failure
  const misses = new Map<string, string>();
  const look = sampleSliceLookup(d, misses, new Set(['gone.wav']));
  expect(look({ s: 'gone' })).toBe(6);
  expect(misses.size).toBe(0);
});

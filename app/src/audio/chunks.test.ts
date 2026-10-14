import { expect, test } from 'vitest';
import { mini } from '@strudel/mini';
import { stack } from '@strudel/core';
import {
  DEFAULT_CHUNKING, MIN_PREROLL_SEC, effectTailSec, onsetHaps, planChunks, prerollSamples, ringsUntilSec, scanQuietSeams, seamStep, totalSamples,
  type ChunkPlan,
} from './chunks';

const SR = 48000;
const plan = (pat: any, begin: number, end: number, cps: number, o = DEFAULT_CHUNKING) =>
  planChunks(begin, end, cps, SR, scanQuietSeams(pat, begin, end, cps, o), o);
const sec = (p: ChunkPlan) => p.length / SR;
/** Plans are contiguous and add up to exactly one render's length. */
function expectContiguous(plans: ChunkPlan[], begin: number, end: number, cps: number) {
  let at = 0;
  for (const p of plans) { expect(p.startSample).toBe(at); at += p.length; }
  expect(at).toBe(totalSamples(begin, end, cps, SR));
  expect(plans[0].c0).toBe(begin);
  expect(plans.at(-1)!.c1).toBe(end);
}
/** Stand-in pattern with explicit haps ({ begin, end } in cycles, value). */
const fake = (haps: { begin: number; end: number; value?: object }[]) => ({
  queryArc: (a: number, b: number) => haps
    .filter((h) => h.begin < b && h.end > a)
    .map((h) => ({ hasOnset: () => h.begin >= a, whole: { begin: h.begin, end: h.end }, value: h.value ?? {} })),
});

test('a normal song (drums + short notes) is cut at whole cycles about every 60 s', () => {
  const cps = 0.55;                                    // 33 cycles ≈ 60 s
  const pat = stack(mini('bd*4 [~ sd]'), mini('hh*8'), mini('<c e g>').fmap((n: string) => ({ note: n, release: 0.5 })));
  const plans = plan(pat, 0, 600, cps);                 // ~18 min
  expectContiguous(plans, 0, 600, cps);
  expect(plans.every((p) => p.kind === 'normal')).toBe(true);
  expect(plans.every((p) => Number.isInteger(p.c0) && Number.isInteger(p.c1))).toBe(true);
  for (const p of plans.slice(0, -1)) expect(Math.abs(sec(p) - 60)).toBeLessThan(1 / cps); // nearest grid cycle to 60 s
  expect(sec(plans.at(-1)!)).toBeLessThanOrEqual(120);
  // every chunk's pre-roll is bounded (and at least the effect allowance)
  for (const p of plans.slice(1)) {
    const pre = prerollSamples(pat, p.c0, p.startSample, 0, cps, SR) / SR;
    expect(pre).toBeGreaterThanOrEqual(MIN_PREROLL_SEC);
    expect(pre).toBeLessThanOrEqual(DEFAULT_CHUNKING.maxPrerollSec + 1 / cps);
  }
});

test('every note is triggered by exactly one chunk across the seams', () => {
  const cps = 0.5;
  const pat = stack(mini('bd*4 [~ sd]'), mini('hh*7'), mini('<c@3 e>'));
  const o = { targetSec: 12, minSec: 6, maxSec: 24, longSec: 60, maxPrerollSec: 30 };
  const plans = plan(pat, 0, 64, cps, o);
  expect(plans.length).toBeGreaterThan(5);
  const key = (h: any) => `${h.whole.begin}:${JSON.stringify(h.value)}`;
  const whole = onsetHaps(pat, 0, 64, cps).map(key);
  const chunked = plans.flatMap((p) => onsetHaps(pat, p.c0, p.c1, cps).map(key));
  expect(chunked.sort()).toEqual(whole.sort());
  expect(new Set(chunked).size).toBe(chunked.length);
});

test('a seam is quiet only when everything started before the pre-roll window has rung out', () => {
  const cps = 1, cap = 30;
  // a 100 s note from 0: nothing between 30 s (the cap from the start) and 100 + 0.01 + 8 s is quiet
  const g = scanQuietSeams(fake([{ begin: 0, end: 100 }]), 0, 200, cps, { maxPrerollSec: cap });
  expect(g.step).toBe(1);
  expect([...g.quiet.slice(1, 31)].every(Boolean)).toBe(true);    // the pre-roll reaches back to the start
  expect([...g.quiet.slice(31, 109)].some(Boolean)).toBe(false);
  expect([...g.quiet.slice(109)].every(Boolean)).toBe(true);
  // short notes every second: always quiet (each rings ~8 s, well inside the cap)
  const dense = fake(Array.from({ length: 200 }, (_, i) => ({ begin: i, end: i + 0.5 })));
  expect([...scanQuietSeams(dense, 0, 200, cps, { maxPrerollSec: cap }).quiet.slice(1)].every(Boolean)).toBe(true);
});

test('a drone song falls back to one long chunk, then to a single pass for the rest', () => {
  const cps = 0.5;
  // a 4-minute drone, then short notes: the drone span becomes one exact long chunk
  const droneThenBeat = fake([
    { begin: 0, end: 120, value: { note: 'c2' } },                                // 240 s
    ...Array.from({ length: 300 }, (_, i) => ({ begin: 120 + i, end: 120.5 + i })),
  ]);
  const a = plan(droneThenBeat, 0, 420, cps);
  expectContiguous(a, 0, 420, cps);
  const firstLong = a.findIndex((p) => p.kind === 'long');
  expect(firstLong).toBeGreaterThanOrEqual(0);
  expect(sec(a[firstLong])).toBeGreaterThan(120);
  expect(sec(a[firstLong])).toBeLessThanOrEqual(600);
  expect(a.some((p) => p.kind === 'single')).toBe(false);
  expect(a.slice(firstLong + 1).every((p) => p.kind === 'normal')).toBe(true);  // back to ~60 s chunks
  // an endless drone (20 min): no quiet seam within 10 min of the start -> the rest in one pass
  const drone = fake([{ begin: 0, end: 600, value: { note: 'c1' } }]);
  const b = plan(drone, 0, 600, cps);
  expectContiguous(b, 0, 600, cps);
  expect(b.at(-1)!.kind).toBe('single');
  expect(b.filter((p) => p.kind === 'single')).toHaveLength(1);
  // ...and the chunk before the single pass (if any) only reaches the pre-roll cap from the start
  for (const p of b.slice(0, -1)) expect(p.c1 / cps).toBeLessThanOrEqual(DEFAULT_CHUNKING.maxPrerollSec);
  // a long feedback delay rings far longer than the cap: treated like a drone
  const delayed = fake(Array.from({ length: 400 }, (_, i) => ({ begin: i, end: i + 0.25, value: { delay: 0.5, delayfeedback: 0.98, delaytime: 0.5 } })));
  expect(plan(delayed, 0, 400, cps).at(-1)!.kind).toBe('single');
});

test('effect tails: reverb and slow delays extend how long a note rings', () => {
  expect(effectTailSec({}, 1)).toBe(MIN_PREROLL_SEC);
  expect(effectTailSec({ room: 0.5, roomsize: 10 }, 1)).toBe(16);
  expect(effectTailSec({ room: 0.5 }, 1)).toBe(MIN_PREROLL_SEC);                // default 2 s room: 4 s
  expect(effectTailSec({ delay: 0.5, delayfeedback: 0.5, delaytime: 0.375 }, 1)).toBe(MIN_PREROLL_SEC);
  expect(effectTailSec({ delay: 0.5, delayfeedback: 0.9, delaytime: 0.5 }, 1)).toBeCloseTo(0.5 * Math.log(1e-5) / Math.log(0.9) + 1, 6);
  expect(effectTailSec({ delay: 0.5, delayfeedback: 5, delaytime: 1 }, 1)).toBeCloseTo(Math.log(1e-5) / Math.log(0.98) + 1, 6); // clamped like superdough
  expect(effectTailSec({ delay: 0.5, delayfeedback: 0.9 }, 0.5)).toBeGreaterThan(MIN_PREROLL_SEC);  // delaysync 3/16 cycle
  const h = { whole: { begin: 2, end: 3 }, value: { release: 2 } };
  expect(ringsUntilSec(h, 0, 1)).toBe(3 + 2 + MIN_PREROLL_SEC);
  expect(ringsUntilSec({ ...h, value: { release: 'x' } }, 0, 1)).toBeCloseTo(3 + 0.01 + MIN_PREROLL_SEC, 9);
});

test('pre-roll covers every hap still ringing at the seam, within the cap; never before begin', () => {
  const sr = 1000;
  expect(prerollSamples(mini('bd'), 0, 0, 0, 1, sr)).toBe(0);                                // first chunk
  // short notes: the allowance, reaching the onset of the last note whose tail overlaps the seam
  expect(prerollSamples(fake([{ begin: 39, end: 39.5 }]), 40, 40 * sr, 0, 1, sr)).toBe(MIN_PREROLL_SEC * sr);
  expect(prerollSamples(mini('bd*4'), 40, 40 * sr, 0, 1, sr)).toBe(8.25 * sr);  // 31.75 + 0.25 + 0.01 + 8 > 40
  // a note from 20 s before the seam, lasting 30 s: back to its onset
  expect(prerollSamples(fake([{ begin: 10, end: 40 }]), 30, 30 * sr, 0, 1, sr)).toBe(20 * sr);
  // ended 5 s before the seam, still in its effect tail: back to its onset
  expect(prerollSamples(fake([{ begin: 15, end: 25 }]), 30, 30 * sr, 0, 1, sr)).toBe(15 * sr);
  // rung out: not replayed
  expect(prerollSamples(fake([{ begin: 5, end: 10 }]), 30, 30 * sr, 0, 1, sr)).toBe(MIN_PREROLL_SEC * sr);
  // never before begin
  expect(prerollSamples(mini('bd'), 3, 3 * sr, 0, 1, sr)).toBe(3 * sr);
});

test('grid: whole cycles, or fractions so seams are at most 10 s apart', () => {
  expect(seamStep(0.5)).toBe(1);
  expect(seamStep(0.1)).toBe(1);
  expect(seamStep(1 / 150)).toBe(1 / 15);
  // 150 s cycles still split exactly
  const plans = plan(mini('c'), 0, 4, 1 / 150);
  expectContiguous(plans, 0, 4, 1 / 150);
  expect(plans.every((p) => sec(p) <= 600)).toBe(true);
  expect(plan(mini('bd'), 1.25, 3.5, 0.5)).toHaveLength(1);
  expect(plan(mini('bd'), 1, 1, 0.5)).toEqual([]);
});

test('unclipped samples ring for their whole slice; unknown lengths count as ringing', () => {
  const cps = 1;
  // a 0.25-cycle hap of a 6 s one-shot played at speed 0.25: 24 s of sound
  const h = { whole: { begin: 2, end: 2.25 }, value: { s: 'gong', speed: 0.25 } };
  const slice = (v: Record<string, unknown>) => (v.s === 'gong' ? 6 / Math.abs(Number(v.speed ?? 1)) : undefined);
  expect(ringsUntilSec(h, 0, cps)).toBeCloseTo(2.25 + 0.01 + MIN_PREROLL_SEC, 9);
  expect(ringsUntilSec(h, 0, cps, slice)).toBeCloseTo(2 + 24 + 0.01 + MIN_PREROLL_SEC, 9);
  expect(ringsUntilSec(h, 0, cps, () => null)).toBe(Infinity);
  expect(ringsUntilSec(h, 0, cps, () => undefined)).toBeCloseTo(2.25 + 0.01 + MIN_PREROLL_SEC, 9); // clipped/looped/synth
  // one gong every 20 s: hap-based every seam looks quiet; with the slice, seams within its 24 s + tail are not
  const gongs = fake(Array.from({ length: 10 }, (_, i) => ({ begin: i * 20, end: i * 20 + 0.25, value: { s: 'gong', speed: 0.25 } })));
  const o = { maxPrerollSec: 10 };
  const naive = scanQuietSeams(gongs, 0, 200, cps, o);
  const real = scanQuietSeams(gongs, 0, 200, cps, o, slice);
  expect(naive.quiet[35]).toBe(1);
  expect(real.quiet[35]).toBe(0);                 // the gong from 20 s still sounds at 35 s (until 52 s)
  expect(real.quiet[60]).toBe(0);                 // the one from 40 s until 72 s
  expect([...scanQuietSeams(gongs, 0, 200, cps, o, () => null).quiet.slice(11)].some(Boolean)).toBe(false);
  // the pre-roll reaches back to a sample still sounding at the seam
  expect(prerollSamples(gongs, 30, 30_000, 0, cps, 1000, 30, slice)).toBe(30_000);   // back to the gong at 0 s
  expect(prerollSamples(gongs, 30, 30_000, 0, cps, 1000, 30)).toBe(MIN_PREROLL_SEC * 1000);
});

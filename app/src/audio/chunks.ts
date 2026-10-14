// Chunked offline rendering: long songs are rendered in pieces so the OfflineAudioContext (and the
// runtime's memory) stays bounded, and every piece is sample-identical to a single-pass render.
//
// - Sample positions come from absolute song time, so the total length is exactly
//   ceil((end - begin) / cps * sampleRate), as for a single render.
// - Seams are only placed where the song is "quiet enough": a seam s is quiet when every hap that
//   started more than `maxPrerollSec` before s has stopped ringing by s (its end, or the end of an
//   unclipped sample's whole slice, + release + effect tail; see ringsUntilSec). A chunk's context then starts a bounded pre-roll before its seam
//   (at least the effect allowance, MIN_PREROLL_SEC, and reaching back to the earliest hap still
//   ringing at the seam, never more than maxPrerollSec), replays every hap with an onset from there,
//   and the pre-roll is thrown away. Voices, reverb/delay tails, compressor/ducking and cut groups
//   are then in the same state at the seam as in one pass.
// - Seams are searched on a grid of whole cycles (fractions of a cycle when a cycle is over 10 s):
//   preferably the quiet one closest to `targetSec` into the chunk, anywhere within
//   [minSec, maxSec]. Without one (a drone, a long reverb/delay tail), the chunk runs on to the
//   first quiet seam up to `longSec` of song time; without even that, the rest of the song is
//   rendered in one pass (memory = that length). Output is exact in every case.

export interface ChunkPlan {
  c0: number;
  c1: number;
  startSample: number;
  length: number;
  /** normal: seam within [minSec, maxSec]; long: up to longSec; single: the rest in one pass. */
  kind: 'normal' | 'long' | 'single';
}

export interface ChunkingOptions {
  targetSec: number;
  minSec: number;
  maxSec: number;
  longSec: number;
  /** Upper bound of a chunk's pre-roll (and of how far back a seam looks for ringing haps). */
  maxPrerollSec: number;
}

export const DEFAULT_CHUNKING: ChunkingOptions = { targetSec: 60, minSec: 30, maxSec: 120, longSec: 600, maxPrerollSec: 30 };

/** Effect allowance: the least pre-roll, and the least tail assumed after any note's release. */
export const MIN_PREROLL_SEC = 8;

type Queryable = { queryArc(a: number, b: number, s?: object): any[] };

export const totalSamples = (begin: number, end: number, cps: number, sampleRate: number) =>
  Math.ceil(((end - begin) / cps) * sampleRate);

/** Haps that start in [c0, c1), in onset order (order matters for `cut` and other graph-state controls). */
export function onsetHaps(pattern: Queryable, c0: number, c1: number, cps: number): any[] {
  return pattern.queryArc(c0, c1, { _cps: cps })
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
}

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const DELAY_FLOOR = 1e-5; // -100 dB

/**
 * Seconds a hap keeps sounding after its release ends: at least MIN_PREROLL_SEC; longer for a
 * reverb (superdough's impulse response lasts 1.5 x roomsize) or a delay whose feedback takes longer
 * to fall below -100 dB (feedback clamped to 0.98 as superdough does).
 */
export function effectTailSec(value: unknown, cps: number): number {
  const v = (typeof value === 'object' && value ? value : {}) as Record<string, unknown>;
  let tail = MIN_PREROLL_SEC;
  if (num(v.room, 0) > 0) tail = Math.max(tail, 1.5 * Math.max(0, num(v.roomsize ?? v.size, 2)) + 1);
  if (num(v.delay, 0) > 0) {
    const fb = Math.min(0.98, num(v.delayfeedback, 0.5));
    const dt = num(v.delaytime, num(v.delaysync, 3 / 16) / cps);
    if (fb > 0 && dt > 0) tail = Math.max(tail, dt * (Math.log(DELAY_FLOOR) / Math.log(fb)) + 1);
  }
  return tail;
}

/**
 * How long a sample really plays, for haps where superdough ignores the hap's end: a sample with none of
 * clip / loop / release set plays its whole slice ((end - begin) x buffer duration / |playback rate|).
 * Returns seconds, `undefined` when the hap's own end applies (synths, clipped/looped/released samples),
 * or `null` when the sample's length is not known (yet): then the hap counts as ringing indefinitely.
 */
export type SampleSliceLookup = (value: Record<string, unknown>) => number | null | undefined;

/** Song second (from `begin`) at which a hap has stopped sounding, effect tails included. */
export function ringsUntilSec(h: any, begin: number, cps: number, sliceSec?: SampleSliceLookup): number {
  const v = typeof h.value === 'object' && h.value ? h.value : {};
  const release = Math.max(0, num(v.release, 0.01), num(v.FXrelease, 0));
  let endSec = (h.whole.end.valueOf() - begin) / cps;
  const slice = sliceSec?.(v);
  if (slice === null) return Infinity;
  if (slice !== undefined) endSec = Math.max(endSec, (h.whole.begin.valueOf() - begin) / cps + slice);
  return endSec + release + effectTailSec(v, cps);
}

/** Seam grid in cycles: one cycle, or a fraction of one so grid points are at most 10 s apart. */
export const seamStep = (cps: number) => { const cycleSec = 1 / cps; return cycleSec <= 10 ? 1 : 1 / Math.ceil(cycleSec / 10); };

export interface SeamGrid { begin: number; step: number; count: number; quiet: Uint8Array }

/**
 * One pass over the song's onsets (queried a window at a time) marking which grid seams are quiet.
 * quiet[k] refers to the seam at begin + k * step (0 < k < count).
 */
export function scanQuietSeams(pattern: Queryable, begin: number, end: number, cps: number, opts: Pick<ChunkingOptions, 'maxPrerollSec'> = DEFAULT_CHUNKING, sliceSec?: SampleSliceLookup): SeamGrid {
  const step = seamStep(cps);
  const count = Math.max(1, Math.ceil((end - begin) / step - 1e-9));
  // ring[k]: latest "stops sounding" second of haps with onsets in grid cell k
  const ring = new Float64Array(count).fill(-Infinity);
  const WINDOW = 64;
  for (let k = 0; k < count; k += WINDOW) {
    const a = begin + k * step, b = Math.min(end, begin + (k + WINDOW) * step);
    for (const h of onsetHaps(pattern, a, b, cps)) {
      const cell = Math.min(count - 1, Math.max(0, Math.floor((h.whole.begin.valueOf() - begin) / step + 1e-9)));
      const r = ringsUntilSec(h, begin, cps, sliceSec);
      if (r > ring[cell]) ring[cell] = r;
    }
  }
  // until[k]: latest ring of all onsets before seam k
  const until = new Float64Array(count + 1);
  until[0] = -Infinity;
  for (let k = 0; k < count; k++) until[k + 1] = Math.max(until[k], ring[k]);
  const capSteps = Math.ceil((opts.maxPrerollSec * cps) / step - 1e-9);
  const quiet = new Uint8Array(count);
  for (let k = 1; k < count; k++) {
    const seamSec = (k * step) / cps;
    // within the pre-roll cap of `begin` the pre-roll simply replays everything from the start
    quiet[k] = k <= capSteps || until[k - capSteps] <= seamSec + 1e-9 ? 1 : 0;
  }
  return { begin, step, count, quiet };
}

/** Chunk plan over [begin, end) from the quiet seams (see the file comment). */
export function planChunks(begin: number, end: number, cps: number, sampleRate: number, grid: SeamGrid, options: Partial<ChunkingOptions> = {}): ChunkPlan[] {
  if (!(end > begin) || !(cps > 0)) return [];
  const o = { ...DEFAULT_CHUNKING, ...options };
  const total = totalSamples(begin, end, cps, sampleRate);
  const { step, count, quiet } = grid;
  const seam = (k: number) => (k >= count ? end : begin + k * step);
  const sec = (c: number) => (c - begin) / cps;
  const at = (c: number) => (c >= end ? total : Math.round(sec(c) * sampleRate));
  const stepsFor = (s: number) => (s * cps) / step;
  const plans: ChunkPlan[] = [];
  const push = (k0: number, k1: number, kind: ChunkPlan['kind']) => {
    const c0 = seam(k0), c1 = seam(k1);
    const startSample = at(c0), endSample = at(c1);
    if (endSample > startSample) plans.push({ c0, c1, startSample, length: endSample - startSample, kind });
  };
  let k0 = 0;
  for (;;) {
    const rem = sec(end) - sec(seam(k0));
    if (rem <= o.targetSec + 1e-9) { push(k0, count, 'normal'); break; }
    // a quiet seam in [minSec, maxSec], closest to targetSec (earlier on a tie)
    const lo = k0 + Math.ceil(stepsFor(o.minSec) - 1e-9), hi = Math.min(count - 1, k0 + Math.floor(stepsFor(o.maxSec) + 1e-9));
    const target = k0 + Math.round(stepsFor(o.targetSec));
    let best = -1;
    for (let d = 0; best < 0 && (target - d >= lo || target + d <= hi); d++) {
      if (target - d >= lo && target - d <= hi && quiet[target - d]) best = target - d;
      else if (d > 0 && target + d <= hi && target + d >= lo && quiet[target + d]) best = target + d;
    }
    if (best > k0) { push(k0, best, 'normal'); k0 = best; continue; }
    if (rem <= o.maxSec + 1e-9) { push(k0, count, 'normal'); break; }
    // no quiet seam nearby (drone, long tail): the first quiet one up to longSec
    const longHi = Math.min(count - 1, k0 + Math.floor(stepsFor(o.longSec) + 1e-9));
    let long = -1;
    for (let k = Math.max(hi + 1, k0 + 1); k <= longHi; k++) if (quiet[k]) { long = k; break; }
    if (long > k0) { push(k0, long, 'long'); k0 = long; continue; }
    if (rem <= o.longSec + 1e-9) { push(k0, count, 'long'); break; }
    // never quiet: the rest in one pass (exact; memory = its length)
    push(k0, count, 'single');
    break;
  }
  return plans;
}

/**
 * Pre-roll for a chunk starting at cycle `c0` (sample `startSample`): at least MIN_PREROLL_SEC and
 * back to the onset of every hap still ringing at c0 (ringsUntilSec). Seams come from planChunks, so
 * those onsets lie within `maxPrerollSec` (one grid step of slack); never before `begin`.
 */
export function prerollSamples(pattern: Queryable, c0: number, startSample: number, begin: number, cps: number, sampleRate: number, maxPrerollSec = DEFAULT_CHUNKING.maxPrerollSec, sliceSec?: SampleSliceLookup): number {
  if (startSample <= 0) return 0;
  const from = Math.max(begin, c0 - maxPrerollSec * cps - seamStep(cps));
  const seamSec = (c0 - begin) / cps;
  let sec = MIN_PREROLL_SEC;
  for (const h of onsetHaps(pattern, from, c0, cps)) {
    if (ringsUntilSec(h, begin, cps, sliceSec) > seamSec) sec = Math.max(sec, (c0 - h.whole.begin.valueOf()) / cps);
  }
  return Math.min(startSample, Math.ceil(sec * sampleRate));
}

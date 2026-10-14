// Length of unclipped samples for the export seam scan (see SampleSliceLookup in chunks.ts), from
// superdough's loaded-buffer cache with the same arithmetic as its sampler (playback rate from speed and
// pitch, unit "c", begin/end). The superdough functions are passed in so this stays testable.
import { DEFAULT_CHUNKING, scanQuietSeams, type ChunkingOptions, type SampleSliceLookup } from './chunks';

export interface SampleDeps {
  getSound(s: string): { data?: { type?: string; samples?: unknown } } | undefined;
  getSampleInfo(value: Record<string, unknown>, bank: unknown): { url: string; label: string; playbackRate: number };
  getLoadedBuffer(url: string): { duration: number } | undefined;
  loadBuffer(url: string, label: string): Promise<unknown> | unknown;
}

const fin = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * Lookup for the scan. A loaded buffer always wins; a sample whose load failed in this scan (`failed`)
 * uses its hap's end (the render reports it missing); any other unloaded sample is recorded in `misses`
 * (url -> label) and is unknown.
 */
export function sampleSliceLookup(deps: SampleDeps, misses: Map<string, string>, failed: ReadonlySet<string> = new Set()): SampleSliceLookup {
  return (v) => {
    if (v.clip != null || v.loop != null || v.release != null || typeof v.s !== 'string') return undefined;
    const s = v.bank && v.s ? `${v.bank}_${v.s}` : v.s;
    const sound = deps.getSound(s);
    if (sound?.data?.type !== 'sample') return undefined;
    if (v.speed === 0) return 0;
    let info: { url: string; label: string; playbackRate: number };
    try { info = deps.getSampleInfo({ ...v, s }, sound.data.samples); } catch { return undefined; }
    const url = String(info.url).replace('#', '%23');
    const buffer = deps.getLoadedBuffer(url);
    if (!buffer) {
      if (failed.has(url)) return undefined;
      misses.set(url, info.label);
      return null;
    }
    const rate = info.playbackRate * (v.unit === 'c' ? buffer.duration : 1);
    if (!(rate > 0)) return undefined;
    return Math.max(0, fin(v.end, 1) - fin(v.begin, 0)) * (buffer.duration / rate);
  };
}

/**
 * Quiet seams with every unclipped sample's length known: samples not loaded yet are loaded and the
 * song rescanned. A sample whose load fails uses its hap's end for the rest of this scan (and the
 * export's pre-rolls); the next export tries it again.
 */
export async function scanWithSamples(pattern: { queryArc(a: number, b: number, s?: object): any[] }, begin: number, end: number, cps: number, chunking: Pick<ChunkingOptions, 'maxPrerollSec'> = DEFAULT_CHUNKING, deps: SampleDeps) {
  const misses = new Map<string, string>();
  const failed = new Set<string>();
  const sliceSec = sampleSliceLookup(deps, misses, failed);
  let grid = scanQuietSeams(pattern, begin, end, cps, chunking, sliceSec);
  if (misses.size) {
    await Promise.all([...misses].map(async ([url, label]) => {
      try {
        await deps.loadBuffer(url, label);
        if (!deps.getLoadedBuffer(url)) failed.add(url);
      } catch { failed.add(url); }
    }));
    misses.clear();
    grid = scanQuietSeams(pattern, begin, end, cps, chunking, sliceSec);
  }
  return { grid, sliceSec };
}

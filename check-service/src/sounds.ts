import fs from 'node:fs/promises';
import path from 'node:path';
import { DIRT_SOUNDS, type SoundPackSet } from '@shawarma/shared';
import { CACHE_DIR, SAMPLE_CDN, SOUND_PACK_SET, sampleMapsFor } from './config';

// superdough synths + noise (from superdough/synth.mjs registerSynthSounds)
const SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'saw', 'tri', 'sqr', 'supersaw', 'pulse', 'white', 'pink', 'brown', 'crackle', 'sbd', 'bytebeat', 'user'];

const FETCH_TIMEOUT_MS = 10_000;
const cached = new Map<SoundPackSet, Promise<Set<string> | null>>();

/** Sound names of one sample map (local cache first, then the CDN), or null if it could not be loaded. */
async function loadMap(file: string): Promise<string[] | null> {
  const local = path.join(CACHE_DIR, file);
  try {
    return Object.keys(JSON.parse(await fs.readFile(local, 'utf8'))).filter((k) => !k.startsWith('_'));
  } catch {
    try {
      const res = await fetch(`${SAMPLE_CDN}/${file}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const text = await res.text();
      const names = Object.keys(JSON.parse(text)).filter((k) => !k.startsWith('_'));
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(local, text);
      return names;
    } catch {
      return null; // offline, slow (10 s timeout) or bad JSON
    }
  }
}

/**
 * All known sound names of a pack set (default: SOUND_PACKS), or null when a sample map could not be
 * loaded (offline): an incomplete list would flag real samples as unknown. Only a complete list is
 * cached; null retries next time. Hosted: no drum machines, wavetables or Dirt-Samples names.
 */
export function knownSounds(set: SoundPackSet = SOUND_PACK_SET): Promise<Set<string> | null> {
  let p = cached.get(set);
  if (!p) {
    p = (async () => {
      const gm = (await import('@strudel/soundfonts/gm.mjs').catch(() => ({ default: {} }))).default as Record<string, unknown>;
      const maps = await Promise.all(sampleMapsFor(set).map(loadMap));
      if (maps.some((m) => m === null)) {
        cached.delete(set);
        return null;
      }
      return new Set([...SYNTHS, ...(set === 'all' ? DIRT_SOUNDS : []), ...Object.keys(gm), ...(maps as string[][]).flat()]);
    })();
    cached.set(set, p);
  }
  return p;
}

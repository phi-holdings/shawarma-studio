import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR, SAMPLE_CDN, SAMPLE_MAPS } from './config';

// superdough synths + noise (from superdough/synth.mjs registerSynthSounds)
const SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'saw', 'tri', 'sqr', 'supersaw', 'pulse', 'white', 'pink', 'brown', 'crackle', 'sbd', 'bytebeat', 'user'];
// Dirt-Samples aliases registered by strudel.cc prebake
const DIRT = ['casio', 'crow', 'insect', 'wind', 'jazz', 'metal', 'east', 'space', 'numbers', 'num'];

const FETCH_TIMEOUT_MS = 10_000;
let cached: Promise<Set<string> | null> | null = null;

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
 * All known sound names, or null when a sample map could not be loaded (offline): an incomplete list
 * would flag real samples as unknown. Only a complete list is cached; null retries next time.
 */
export function knownSounds(): Promise<Set<string> | null> {
  cached ??= (async () => {
    const gm = (await import('@strudel/soundfonts/gm.mjs').catch(() => ({ default: {} }))).default as Record<string, unknown>;
    const maps = await Promise.all(SAMPLE_MAPS.map(loadMap));
    if (maps.some((m) => m === null)) {
      cached = null;
      return null;
    }
    return new Set([...SYNTHS, ...DIRT, ...Object.keys(gm), ...(maps as string[][]).flat()]);
  })();
  return cached;
}

import os from 'node:os';
import path from 'node:path';

import { parseSoundPackSet, SAMPLE_CDN, soundPacksFor, type SoundPackSet } from '@shawarma/shared';

export { SAMPLE_CDN };
/** SOUND_PACKS=hosted: only the cleanly licensed sample packs (deploy/docker-compose.yml); default all. */
export const SOUND_PACK_SET: SoundPackSet = parseSoundPackSet(process.env.SOUND_PACKS);
/** The sample maps of a pack set (file names on SAMPLE_CDN). */
export const sampleMapsFor = (set: SoundPackSet): string[] => soundPacksFor(set).map((p) => p.map);
/** Sample-map cache. SHAWARMA_CACHE_DIR wins; fake-AI runs (tests, e2e) default to a temp dir. */
export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SHAWARMA_CACHE_DIR) return env.SHAWARMA_CACHE_DIR;
  if (env.SHAWARMA_FAKE_AI) return path.join(os.tmpdir(), 'shawarma-fake-cache');
  return path.join(os.homedir(), '.shawarma-cache');
}
export const CACHE_DIR = resolveCacheDir();

import os from 'node:os';
import path from 'node:path';

export const SAMPLE_CDN = 'https://strudel.b-cdn.net';
export const SAMPLE_MAPS = ['piano.json', 'vcsl.json', 'tidal-drum-machines.json', 'uzu-drumkit.json', 'uzu-wavetables.json', 'mridangam.json'];
/** Sample-map cache. SHAWARMA_CACHE_DIR wins; fake-AI runs (tests, e2e) default to a temp dir. */
export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SHAWARMA_CACHE_DIR) return env.SHAWARMA_CACHE_DIR;
  if (env.SHAWARMA_FAKE_AI) return path.join(os.tmpdir(), 'shawarma-fake-cache');
  return path.join(os.homedir(), '.shawarma-cache');
}
export const CACHE_DIR = resolveCacheDir();

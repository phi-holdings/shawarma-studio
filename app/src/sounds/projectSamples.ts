// A project's own samples as the song runtime loads them: the server's generated strudel.json, checked.
import { isSoundName } from '../runtime/protocol';

const MAX_SETS = 500;
const MAX_FILES = 1000;

/** Only the local server's per-project sample map (http, loopback host, …/strudel.json). */
export function sampleMapUrlOk(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.pathname.endsWith('/strudel.json')
    && !u.username && !u.password;
}

/** Relative file paths only: no scheme, no absolute path, no `..`. */
const relFile = (f: unknown): f is string =>
  typeof f === 'string' && f.length > 0 && f.length <= 300 && !/^[a-z][a-z0-9+.-]*:/i.test(f) && !f.startsWith('/') && !f.split('/').includes('..');

/**
 * `{ folder: ['folder/file.wav', …] }` from the fetched JSON, lower-cased sound names, with `?v=<version>` on
 * each file so a replaced file is fetched again (superdough caches buffers by URL). Malformed sets are skipped.
 */
export function projectSampleMap(json: unknown, version?: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out;
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  for (const [k, files] of Object.entries(json).slice(0, MAX_SETS)) {
    if (k.startsWith('_') || !isSoundName(k) || !Array.isArray(files) || files.length === 0) continue;
    const ok = files.slice(0, MAX_FILES).filter(relFile);
    if (ok.length) out[k.toLowerCase()] = ok.map((f) => f + v);
  }
  return out;
}

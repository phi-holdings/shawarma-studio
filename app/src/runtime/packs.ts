// The sample-pack set travels to the song runtime in its URL (runtime.html?n=<nonce>&p=hosted), set by
// the app from /api/me's mode. Absent means all packs (local mode).
import type { SoundPackSet } from '@shawarma/shared';

export const PACKS_PARAM = 'p';

export function packsFromSearch(search: string): SoundPackSet {
  return new URLSearchParams(search).get(PACKS_PARAM) === 'hosted' ? 'hosted' : 'all';
}

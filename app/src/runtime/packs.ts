// The sample-pack set travels to the song runtime in its URL (runtime.html?n=<nonce>&p=hosted), set by
// the app from /api/me's mode. Absent means all packs (local mode). So does where the packs are served
// (&s=<url>, /api/me's packsUrl in hosted mode); absent means Strudel's CDNs.
import { selfHostedPacksUrl, type SoundPackSet } from '@shawarma/shared';

export const PACKS_PARAM = 'p';
export const PACKS_URL_PARAM = 's';

/** The self-hosted packs URL from the runtime's URL, or null (Strudel's CDNs); anything but http(s) is ignored. */
export function packsUrlFromSearch(search: string): string | null {
  return selfHostedPacksUrl(new URLSearchParams(search).get(PACKS_URL_PARAM));
}

export function packsFromSearch(search: string): SoundPackSet {
  return new URLSearchParams(search).get(PACKS_PARAM) === 'hosted' ? 'hosted' : 'all';
}

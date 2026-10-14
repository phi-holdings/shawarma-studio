// The Strudel reference served by GET /reference: Strudel's function reference (JSDoc) and docs pages
// (MDX), built by `pnpm --filter @shawarma/check-service build-reference`. Strudel is AGPL-3.0 and this
// package is too; no example tunes (CC BY-NC-SA) are included.
export const STRUDEL_LICENSE = 'AGPL-3.0, Strudel';
export const STRUDEL_REPO_URL = 'https://codeberg.org/uzu/strudel';

/** Entry text stays near this many characters, so 5-10 results are about 2k tokens. */
export const MAX_ENTRY_CHARS = 1500;

export type ReferenceKind = 'function' | 'doc';

export interface ReferenceEntry {
  kind: ReferenceKind;
  /** Stable id: 'function:delay', 'doc:learn/effects.mdx#orbits'. */
  ref: string;
  title: string;
  /** The text that is searched and shown. */
  content: string;
  /** A link to the source at the pinned commit, plus the licence. */
  source: string;
  /** Functions only. */
  name?: string;
  synonyms?: string[];
  description?: string;
  examples?: string[];
}

export interface ReferenceFile {
  generatedFrom: { repo: string; commit: string };
  license: string;
  note: string;
  entries: ReferenceEntry[];
}

export function strudelUrl(commit: string, file: string, line?: number): string {
  return `${STRUDEL_REPO_URL}/src/commit/${commit}/${file}${line ? `#L${line}` : ''}`;
}

/** Lower-case dash slug for anchors: "Continuous changes" -> "continuous-changes". */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[`'"]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}

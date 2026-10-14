import type { SongMap } from '@shawarma/shared';

/** What to export: the whole song, one section of the arrangement, or a span of cycles. */
export type ExportRange =
  | { kind: 'all' }
  | { kind: 'section'; index: number }
  | { kind: 'cycles'; from: number; to: number };

/** Cycles rendered for a song without arrange(): its length is unknown, so a fixed loop. */
export const FALLBACK_CYCLES = 8;
/** Longest cycle span accepted for a custom range (well past any real song). */
export const MAX_RANGE_CYCLES = 4096;

export class ExportRangeError extends Error {}

export interface ResolvedRange { from: number; to: number; label: string; suffix: string | null }

/** URL/file-safe slug: letters and digits of any script, "-" between words. */
const slug = (s: string) => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const num = (n: number) => String(Number(n.toFixed(3))).replace('.', '_');

/**
 * Start and end cycle for an export. A section comes from the song map; a custom span is checked
 * (end after start, inside the song when its length is known). `suffix` names the file
 * (`<project>-<suffix>`), null for the whole song so it keeps its usual name.
 */
export function resolveRange(range: ExportRange, map: SongMap | null): ResolvedRange {
  const total = map?.totalCycles ?? FALLBACK_CYCLES;
  if (range.kind === 'all') return { from: 0, to: total, label: 'whole song', suffix: null };
  if (range.kind === 'section') {
    const s = map?.sections[range.index];
    if (!s) throw new ExportRangeError(map ? 'That section is no longer in the song; pick another one.' : 'The song has no sections (no arrange() call), so export the whole song or a cycle range.');
    const label = s.label.trim() || `section ${range.index + 1}`;
    return { from: s.startCycle, to: s.startCycle + s.cycles, label, suffix: [`section-${range.index + 1}`, slug(label)].filter(Boolean).join('-') };
  }
  const { from, to } = range;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new ExportRangeError('Enter a start and an end cycle as numbers.');
  if (from < 0) throw new ExportRangeError('The start cycle cannot be negative.');
  if (to <= from) throw new ExportRangeError('The end cycle must be after the start cycle.');
  if (map && to > map.totalCycles) throw new ExportRangeError(`The song is ${map.totalCycles} cycles long; end at ${map.totalCycles} or earlier.`);
  if (to - from > MAX_RANGE_CYCLES) throw new ExportRangeError(`A range can be at most ${MAX_RANGE_CYCLES} cycles.`);
  return { from, to, label: `cycles ${from}–${to}`, suffix: `cycles-${num(from)}-${num(to)}` };
}

/** Seconds a cycle span lasts at `cps` cycles per second. */
export const rangeSeconds = (r: { from: number; to: number }, cps: number) => (r.to - r.from) / cps;

/** Export file stem for a range: undefined (server default) for the whole song. */
export function rangeExportName(projectId: string, r: ResolvedRange): string | undefined {
  if (!r.suffix) return undefined;
  const base = slug(projectId) || 'song';
  return `${base}-${r.suffix}`.slice(0, 100).replace(/[-.]+$/, '');
}

// Turns superdough's soundMap into the sound browser's list (runs inside the song runtime; the parent
// re-validates the result in protocol.ts parseSounds).
import { LIMITS, isSoundName, type SoundInfo } from '../runtime/protocol';

type Entry = { data?: Record<string, unknown> } | null | undefined;

/** Variants a sample set offers to `n`: an array's length, or for a pitched map the most files on one note. */
export function variantCount(samples: unknown): number {
  if (Array.isArray(samples)) return samples.length;
  if (samples && typeof samples === 'object') {
    let most = 0;
    for (const v of Object.values(samples)) most = Math.max(most, Array.isArray(v) ? v.length : 1);
    return most;
  }
  return 1;
}

/** Plays a pitch rather than one fixed hit: synths, soundfonts, wavetables and note-keyed sample maps (piano). */
export function isPitched(data: Record<string, unknown> | undefined): boolean {
  const t = data?.type;
  if (t === 'synth' || t === 'soundfont' || t === 'wavetable') return true;
  return t === 'sample' && !Array.isArray(data?.samples) && typeof data?.samples === 'object' && data?.samples !== null;
}

/** First file URL of a sample set (array or note map). */
function firstUrl(samples: unknown): string | undefined {
  const v = Array.isArray(samples) ? samples[0] : samples && typeof samples === 'object' ? Object.values(samples)[0] : undefined;
  const u = Array.isArray(v) ? v[0] : v;
  return typeof u === 'string' ? u : undefined;
}

/**
 * The bank as people write it (`RolandTR808`): superdough lower-cases keys, so the original casing is
 * recovered from the sample folder in the file URL when one matches; else the lower-case prefix.
 */
export function bankName(prefix: string, samples: unknown): string {
  const url = firstUrl(samples);
  if (url) {
    for (const seg of url.split(/[/?#]/)) {
      let d = seg;
      try { d = decodeURIComponent(seg); } catch { /* keep raw */ }
      if (d.toLowerCase() === prefix && isSoundName(d)) return d;
    }
  }
  return prefix;
}

/** The browser's list: one entry per sound (aliases folded into the original's tags), sorted by name. */
export function soundCatalog(map: Record<string, Entry>): SoundInfo[] {
  const byEntry = new Map<object, SoundInfo>();
  const out: SoundInfo[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object' || key.startsWith('_') || !isSoundName(key)) continue;
    const seen = byEntry.get(entry);
    if (seen) {
      // an alias (aliasBank copies the entry under `<alias>_<sound>`): searchable by the alias bank's name
      const alias = key.includes('_') ? key.slice(0, key.indexOf('_')) : key;
      const tags = (seen.tags ??= []);
      if (!tags.includes(alias) && tags.length < LIMITS.soundTags) tags.push(alias);
      continue;
    }
    const d = entry.data ?? {};
    let info: SoundInfo | null = null;
    switch (d.type) {
      case 'sample': {
        const count = Math.min(variantCount(d.samples), LIMITS.soundVariants);
        if (d.tag === 'drum-machines') {
          const i = key.indexOf('_');
          info = i > 0
            ? { name: key, type: 'drum-machine', bank: bankName(key.slice(0, i), d.samples), count }
            : { name: key, type: 'drum-machine', count };
        } else {
          const tags = [...(d.tag === 'project' ? ['project'] : []), ...(isPitched(d) ? ['pitched'] : [])];
          info = { name: key, type: 'sample', count, ...(tags.length ? { tags } : {}) };
        }
        break;
      }
      case 'wavetable':
        info = { name: key, type: 'synth', count: Math.min(variantCount(d.tables), LIMITS.soundVariants), tags: ['wavetable'] };
        break;
      case 'synth':
        info = { name: key, type: 'synth', count: 1 };
        break;
      case 'soundfont':
        info = { name: key, type: 'soundfont', count: Math.min(Array.isArray(d.fonts) ? d.fonts.length : 1, LIMITS.soundVariants) };
        break;
      default:
        continue; // inputs (the bus) and anything unknown are not browsable
    }
    byEntry.set(entry, info);
    out.push(info);
    if (out.length >= LIMITS.sounds) break;
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

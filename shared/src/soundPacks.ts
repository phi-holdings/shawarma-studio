// The sample packs the editor loads (app/src/strudel/setup.ts) and the check service knows
// (check-service/src/sounds.ts). Local mode loads them from Strudel's sample CDN and the GM soundfonts
// from felixroos.github.io; hosted Shawarma serves its packs itself (deploy/fetch-samples.mts copies them
// to one folder, laid out like the CDN: `<map>`, `<folder>/…`, `gm/<font>.js`), see packSources().
//
// Hosted Shawarma offers only packs whose licence allows it. Local mode (your own machine, and this
// public studio) loads all of them, as strudel.cc does. The app learns the mode from /api/me; the
// check service from SOUND_PACKS (hosted | all, default all).

export type SoundPackSet = 'hosted' | 'all';

export interface SoundCredit {
  /** What the sounds are. */
  title: string;
  /** Who made them, as the licence asks to credit them. */
  author: string;
  licence: string;
  licenceUrl: string | null;
  sourceUrl: string;
}

export interface SoundPack {
  id: string;
  /** Sample map, `<SAMPLE_CDN>/<map>`. */
  map: string;
  /** Folder of the sample files, `<SAMPLE_CDN>/<folder>/`. */
  folder: string;
  /** superdough's tag for the sound browser. */
  tag?: 'drum-machines';
  /** Name prefix of every sound in the pack, when there is one (`.bank("mridangam")` -> `mridangam_ta`). */
  prefix?: string;
  /** Offered in hosted mode. */
  hosted: boolean;
  credit: SoundCredit;
}

export const SAMPLE_CDN = 'https://strudel.b-cdn.net';
/** Where @strudel/soundfonts loads the GM instruments from by default (`<url>/<font>.js`). */
export const GM_SOUNDFONT_CDN = 'https://felixroos.github.io/webaudiofontdata/sound';

/** Where the sample maps/files and the GM soundfonts come from. */
export interface SoundSources {
  /** Sample maps at `<samples>/<map>`, sample files at `<samples>/<folder>/…`. */
  samples: string;
  /** GM soundfonts at `<soundfonts>/<font>.js`. */
  soundfonts: string;
}

/**
 * The sources for a self-hosted packs URL (SHAWARMA_PACKS_URL, e.g. https://shawarma.example/packs),
 * or Strudel's CDNs when there is none. A URL that is not http(s) is ignored (CDNs).
 */
export function soundSources(packsUrl?: string | null): SoundSources {
  const base = selfHostedPacksUrl(packsUrl);
  return base ? { samples: base, soundfonts: `${base}/gm` } : { samples: SAMPLE_CDN, soundfonts: GM_SOUNDFONT_CDN };
}

/** A packs URL normalised (no trailing slash, no query or hash), or null unless it is an http(s) URL. */
export function selfHostedPacksUrl(value?: string | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * A sample map as served from `base` (`<base>/<folder>/` holds its files): every `_base` (top level and
 * per sound) is replaced, so the map works without the folder being passed to samples() too.
 */
export function rewriteSampleMap(map: Record<string, unknown>, filesBase: string): Record<string, unknown> {
  const base = filesBase.endsWith('/') ? filesBase : `${filesBase}/`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === '_base') out[k] = base;
    else if (v && typeof v === 'object' && !Array.isArray(v) && '_base' in v) out[k] = { ...(v as Record<string, unknown>), _base: base };
    else out[k] = v;
  }
  if (!('_base' in out)) return { _base: base, ...out };
  return out;
}

/** Every file path a sample map names (relative to its base), e.g. `bd/10_bd.wav`. */
export function sampleMapFiles(map: Record<string, unknown>): string[] {
  const files = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') files.add(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== '_base') add(x);
  };
  for (const [k, v] of Object.entries(map)) if (k !== '_base') add(v);
  return [...files];
}

export const SOUND_PACKS: readonly SoundPack[] = [
  {
    id: 'piano', map: 'piano.json', folder: 'piano', hosted: true,
    credit: {
      title: 'Salamander Grand Piano V3', author: 'Alexander Holm', licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/', sourceUrl: 'https://archive.org/details/SalamanderGrandPianoV3',
    },
  },
  {
    id: 'vcsl', map: 'vcsl.json', folder: 'VCSL', hosted: true,
    credit: {
      title: 'Versilian Community Sample Library (VCSL)', author: 'Versilian Studios and contributors', licence: 'CC0 1.0',
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceUrl: 'https://github.com/sgossner/VCSL',
    },
  },
  {
    // recordings of commercial drum machines, with no licence: local mode only
    id: 'tidal-drum-machines', map: 'tidal-drum-machines.json', folder: 'tidal-drum-machines/machines', tag: 'drum-machines', hosted: false,
    credit: { title: 'tidal-drum-machines', author: 'ritchse', licence: 'none stated', licenceUrl: null, sourceUrl: 'https://github.com/ritchse/tidal-drum-machines' },
  },
  {
    id: 'uzu-drumkit', map: 'uzu-drumkit.json', folder: 'uzu-drumkit', tag: 'drum-machines', hosted: true,
    credit: {
      title: 'uzu-drumkit', author: 'TidalCycles', licence: 'Unlicense',
      licenceUrl: 'https://unlicense.org/', sourceUrl: 'https://github.com/tidalcycles/uzu-drumkit',
    },
  },
  {
    // no licence in the repository (wt_vgame comes from AKWF-FREE, CC0; wt_digital states none): local mode only
    id: 'uzu-wavetables', map: 'uzu-wavetables.json', folder: 'uzu-wavetables', prefix: 'wt_', hosted: false,
    credit: { title: 'uzu-wavetables', author: 'Glossing; Adventure Kid (AKWF)', licence: 'none stated', licenceUrl: null, sourceUrl: 'https://github.com/tidalcycles/uzu-wavetables' },
  },
  {
    id: 'mridangam', map: 'mridangam.json', folder: 'mrid', tag: 'drum-machines', prefix: 'mridangam_', hosted: true,
    credit: {
      title: 'Mridangam samples', author: 'Arthur Carabott (2022), performed by Harishankar V Menon', licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceUrl: 'https://github.com/yaxu/mrid',
    },
  },
];

/** The General MIDI instruments (`gm_*`, @strudel/soundfonts), offered in both modes. */
export const GM_SOUNDFONT_CREDIT: SoundCredit = {
  title: 'General MIDI instruments (WebAudioFont)', author: 'Sergey Surikov, from GeneralUser GS (S. Christian Collins), FluidR3 (Frank Wen) and other free SoundFonts',
  licence: 'MIT (as published)', licenceUrl: 'https://github.com/surikov/webaudiofontdata/blob/master/LICENSE', sourceUrl: 'https://github.com/surikov/webaudiofontdata',
};

/** `.bank("tr909")`-style aliases for the drum machines: local mode only. */
export const DRUM_MACHINE_ALIASES = 'tidal-drum-machines-alias.json';

/** Dirt-Samples names that strudel.cc registers. The checker accepts them in local mode only. */
export const DIRT_SOUNDS: readonly string[] = ['casio', 'crow', 'insect', 'wind', 'jazz', 'metal', 'east', 'space', 'numbers', 'num'];

/** SOUND_PACKS (or any value meant to be one): empty means all; anything but hosted/all is an error. */
export function parseSoundPackSet(value: string | undefined | null): SoundPackSet {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'all') return 'all';
  if (v === 'hosted') return 'hosted';
  throw new Error(`SOUND_PACKS must be hosted or all, got ${JSON.stringify(value)}`);
}

export function soundPacksFor(set: SoundPackSet): SoundPack[] {
  return SOUND_PACKS.filter((p) => set === 'all' || p.hosted);
}

/** What the credits list shows for a set: its packs, then the GM instruments. */
export function soundCreditsFor(set: SoundPackSet): SoundCredit[] {
  return [...soundPacksFor(set).map((p) => p.credit), GM_SOUNDFONT_CREDIT];
}

/**
 * Whether Strudel code only names sounds of this set, as far as plain text shows: every `.bank("…")`
 * must belong to a pack of the set that has a prefix, and no `s("…")`/`sound("…")` may name a Dirt
 * sound or a sound of a pack outside the set. Always true for `all`. Used to keep the function
 * reference from suggesting removed sounds to the assistant.
 */
export function usesOnlySoundsOf(code: string, set: SoundPackSet): boolean {
  if (set === 'all') return true;
  const inSet = soundPacksFor(set);
  const outside = SOUND_PACKS.filter((p) => !inSet.includes(p));
  for (const m of code.matchAll(/\.bank\(\s*["'`]([^"'`]*)["'`]/g)) {
    const bank = `${m[1].trim().toLowerCase()}_`;
    if (!inSet.some((p) => p.prefix && bank.startsWith(p.prefix))) return false;
  }
  for (const m of code.matchAll(/\b(?:s|sound)\(\s*["'`]([^"'`]*)["'`]/g)) {
    for (const word of m[1].match(/[A-Za-z_][\w]*/g) ?? []) {
      const w = word.toLowerCase();
      if (DIRT_SOUNDS.includes(w)) return false;
      if (outside.some((p) => p.prefix && w.startsWith(p.prefix))) return false;
    }
  }
  return true;
}

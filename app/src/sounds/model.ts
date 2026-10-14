// View model of the sound browser: grouping, search, the windowed row list, keyboard moves and the
// code each sound inserts. Pure (no React, no runtime) so it is unit-tested.
import type { SoundInfo } from '../runtime/protocol';
import { matchFields } from './fuzzy';

export type Filter = 'all' | 'drums' | 'samples' | 'synths' | 'instruments';
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'drums', label: 'Drums' },
  { id: 'samples', label: 'Samples' },
  { id: 'synths', label: 'Synths' },
  { id: 'instruments', label: 'Instruments' },
];

export type SectionId = 'used' | 'project' | 'drums' | 'samples' | 'synths' | 'instruments';
export const SECTION_TITLES: Record<SectionId, string> = {
  used: 'Used in this song',
  project: "This project's samples",
  drums: 'Drum machines',
  samples: 'Sample sets',
  synths: 'Synths',
  instruments: 'Instruments',
};

/** A sound as the browser shows it. */
export interface Sound extends SoundInfo {
  /** What the pad or row shows: a drum machine's sound without its bank (`bd`), else the name. */
  label: string;
  /** One of this project's own samples (from the server listing). */
  project?: boolean;
}

export const filterOf = (s: SoundInfo): Exclude<Filter, 'all'> =>
  s.type === 'drum-machine' ? 'drums' : s.type === 'synth' ? 'synths' : s.type === 'soundfont' ? 'instruments' : 'samples';

export function toSound(s: SoundInfo, project = false): Sound {
  const label = s.type === 'drum-machine' && s.bank && s.name.includes('_') ? s.name.slice(s.name.indexOf('_') + 1) : s.name;
  return { ...s, label, ...(project ? { project } : {}) };
}

// ---- inserted code ----
const pitched = (s: SoundInfo) => s.type === 'synth' || s.type === 'soundfont' || Boolean(s.tags?.includes('pitched'));

/** The snippet "Insert" puts at the cursor: `s("bd").bank("RolandTR808")`, `s("casio:2")`, `note("c3").s("gm_piano")`. */
export function insertTextFor(s: Sound, n = 0): string {
  const v = n > 0 ? `:${n}` : '';
  if (s.type === 'drum-machine' && s.bank) return `s("${s.label}${v}").bank("${s.bank}")`;
  if (pitched(s)) return `note("c3").s("${s.name}${v}")`;
  return `s("${s.name}${v}")`;
}

/** A starter beat for a whole drum machine, from the sounds it has. */
export function bankInsertText(bank: string, sounds: readonly Sound[]): string {
  const has = new Set(sounds.map((s) => s.label));
  const kick = has.has('bd') ? 'bd' : sounds[0]?.label ?? 'bd';
  const hat = has.has('hh') ? 'hh' : has.has('oh') ? 'oh' : null;
  const snare = has.has('sd') ? 'sd' : has.has('cp') ? 'cp' : has.has('rim') ? 'rim' : null;
  const steps = hat && snare ? `${kick} ${hat} ${snare} ${hat}` : snare ? `${kick} ${snare}` : hat ? `${kick} ${hat}` : kick;
  return `s("${steps}").bank("${bank}")`;
}

/** Client-side guess of the server's folder name for a dropped file (same rules as safeFolderName). */
export function folderNameFor(raw: string): string | null {
  const s = raw.replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
  return /^[a-z][a-z0-9_]*$/.test(s) ? s : null;
}

export const AUDIO_FILE = /\.(wav|mp3|ogg|flac)$/i;

// ---- grouping ----
/** Pads in the order drummers expect, then the rest alphabetically. */
const DRUM_ORDER = ['bd', 'sd', 'rim', 'cp', 'hh', 'oh', 'cr', 'rd', 'ht', 'mt', 'lt', 'cb', 'tb', 'sh', 'perc', 'misc', 'fx'];
const drumRank = (label: string) => { const i = DRUM_ORDER.indexOf(label); return i < 0 ? DRUM_ORDER.length : i; };
const byDrum = (a: Sound, b: Sound) => drumRank(a.label) - drumRank(b.label) || a.label.localeCompare(b.label);

export interface BankGroup { bank: string; key: string; sounds: Sound[]; score: number }
export interface Section { id: SectionId; groups?: BankGroup[]; sounds?: Sound[]; total: number }

export interface BrowserInput {
  catalog: readonly SoundInfo[];
  /** This project's samples (server listing), shown in their own section. */
  project: readonly Sound[];
  /** Catalog names the song's code uses. */
  used: ReadonlySet<string>;
  query: string;
  filter: Filter;
}

/** Search fields of a sound: name, label, bank and tags (aliases). */
const fields = (s: Sound) => [s.name, s.label, s.bank, ...(s.tags ?? [])];

/** The sections to show, filtered and (when searching) ranked. */
export function buildSections(input: BrowserInput): Section[] {
  const q = input.query.trim();
  const want = (s: Sound) => input.filter === 'all' || filterOf(s) === input.filter;
  const scored = (list: Sound[]) => {
    const out: { s: Sound; score: number }[] = [];
    for (const s of list) { const score = q ? matchFields(q, fields(s)) : 0; if (score !== null) out.push({ s, score }); }
    if (q) out.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
    return out;
  };
  const projectNames = new Set(input.project.map((p) => p.name));
  const all = input.catalog.filter((s) => !projectNames.has(s.name) && !s.tags?.includes('project')).map((s) => toSound(s));
  const sections: Section[] = [];

  const used = scored(all.filter((s) => input.used.has(s.name) && want(s))).map((x) => x.s);
  const usedProject = input.project.filter((p) => input.used.has(p.name));
  if (used.length + usedProject.length) sections.push({ id: 'used', sounds: [...usedProject, ...used], total: used.length + usedProject.length });

  if (input.filter === 'all' || input.filter === 'samples') {
    const project = scored([...input.project]).map((x) => x.s);
    sections.push({ id: 'project', sounds: project, total: project.length });
  }

  if (input.filter === 'all' || input.filter === 'drums') {
    const groups = new Map<string, BankGroup>();
    for (const { s, score } of scored(all.filter((x) => x.type === 'drum-machine'))) {
      const bank = s.bank ?? '';
      const key = bank.toLowerCase();
      const g = groups.get(key) ?? { bank, key, sounds: [], score: -Infinity };
      g.sounds.push(s);
      g.score = Math.max(g.score, score);
      groups.set(key, g);
    }
    const list = [...groups.values()];
    for (const g of list) g.sounds.sort(byDrum);
    // the plain kit (s("bd") with no bank) first, then machines A-Z; by relevance when searching
    list.sort((a, b) => (q ? b.score - a.score : 0) || (a.bank === '' ? -1 : b.bank === '' ? 1 : a.bank.localeCompare(b.bank)));
    sections.push({ id: 'drums', groups: list, total: list.reduce((n, g) => n + g.sounds.length, 0) });
  }

  for (const id of ['samples', 'synths', 'instruments'] as const) {
    if (input.filter !== 'all' && input.filter !== id) continue;
    const sounds = scored(all.filter((s) => filterOf(s) === id)).map((x) => x.s);
    sections.push({ id, sounds, total: sounds.length });
  }
  return sections;
}

/** How many sounds each filter chip would show for the current search. */
export function filterCounts(catalog: readonly SoundInfo[], project: readonly Sound[], query: string): Record<Filter, number> {
  const q = query.trim();
  const counts: Record<Filter, number> = { all: 0, drums: 0, samples: 0, synths: 0, instruments: 0 };
  const projectNames = new Set(project.map((p) => p.name));
  const add = (s: Sound) => { if (!q || matchFields(q, fields(s)) !== null) { counts[filterOf(s)]++; counts.all++; } };
  for (const s of catalog) if (!projectNames.has(s.name) && !s.tags?.includes('project')) add(toSound(s));
  for (const p of project) add(p);
  return counts;
}

// ---- windowed rows ----
export type Row =
  | { kind: 'section'; key: string; section: SectionId; total: number; collapsed: boolean }
  | { kind: 'bank'; key: string; group: BankGroup }
  | { kind: 'pads'; key: string; items: { sound: Sound; index: number }[] }
  | { kind: 'sound'; key: string; sound: Sound; index: number; section: SectionId }
  | { kind: 'drop'; key: string }
  | { kind: 'note'; key: string; text: string };

export const ROW_HEIGHT: Record<Row['kind'], number> = { section: 40, bank: 38, pads: 66, sound: 44, drop: 112, note: 36 };

/** A selectable sound in keyboard order, with where it sits (row and column) for up/down moves. */
export interface NavItem { id: string; sound: Sound; row: number; col: number; section: SectionId }

export interface RowModel { rows: Row[]; items: NavItem[]; offsets: number[]; height: number }

export function buildRows(sections: readonly Section[], opts: { columns: number; collapsed: ReadonlySet<SectionId>; hasProject: boolean; query: string; loading?: boolean }): RowModel {
  const rows: Row[] = [];
  const items: NavItem[] = [];
  const cols = Math.max(1, opts.columns);
  const add = (sound: Sound, section: SectionId, col: number) => {
    const index = items.length;
    items.push({ id: `snd-${index}`, sound, row: rows.length, col, section });
    return index;
  };
  for (const sec of sections) {
    const collapsed = opts.collapsed.has(sec.id) && !opts.query.trim();
    rows.push({ kind: 'section', key: `h:${sec.id}`, section: sec.id, total: sec.total, collapsed });
    if (collapsed) continue;
    if (sec.id === 'project') {
      if (!opts.hasProject) { rows.push({ kind: 'note', key: 'n:project', text: 'Open a project to add your own samples.' }); continue; }
      for (const s of sec.sounds ?? []) rows.push({ kind: 'sound', key: `s:project:${s.name}`, sound: s, section: sec.id, index: add(s, sec.id, 0) });
      if (!opts.query.trim()) rows.push({ kind: 'drop', key: 'drop' });
      else if (!sec.sounds?.length) rows.push({ kind: 'note', key: 'n:project', text: 'None of your samples match.' });
      continue;
    }
    if (sec.groups) {
      for (const g of sec.groups) {
        rows.push({ kind: 'bank', key: `b:${g.key}`, group: g });
        for (let i = 0; i < g.sounds.length; i += cols) {
          const chunk = g.sounds.slice(i, i + cols);
          const row: Row = { kind: 'pads', key: `p:${g.key}:${i}`, items: [] };
          chunk.forEach((sound, c) => row.items.push({ sound, index: add(sound, sec.id, c) }));
          rows.push(row);
        }
      }
      if (!sec.groups.length && !opts.loading) rows.push({ kind: 'note', key: `n:${sec.id}`, text: opts.query.trim() ? 'No drum machines match.' : 'No drum machines are loaded.' });
      continue;
    }
    for (const s of sec.sounds ?? []) rows.push({ kind: 'sound', key: `s:${sec.id}:${s.name}`, sound: s, section: sec.id, index: add(s, sec.id, 0) });
    if (!sec.sounds?.length && !opts.loading) rows.push({ kind: 'note', key: `n:${sec.id}`, text: `No ${SECTION_TITLES[sec.id].toLowerCase()} match.` });
  }
  const offsets: number[] = [];
  let y = 0;
  for (const r of rows) { offsets.push(y); y += ROW_HEIGHT[r.kind]; }
  return { rows, items, offsets, height: y };
}

/** Rows overlapping [top, top + height) plus `overscan` rows either side: [first, last). */
export function visibleRange(offsets: readonly number[], top: number, height: number, overscan = 6): [number, number] {
  if (!offsets.length) return [0, 0];
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= top) lo = mid; else hi = mid - 1; }
  let end = lo;
  while (end < offsets.length && offsets[end] < top + Math.max(height, 1)) end++;
  return [Math.max(0, lo - overscan), Math.min(offsets.length, end + overscan)];
}

/** Keyboard move from item `i`: left/right walk the order, up/down keep the column across rows. */
export function moveIndex(items: readonly NavItem[], i: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'): number {
  if (!items.length) return -1;
  const cur = items[Math.min(Math.max(i, 0), items.length - 1)];
  const at = items.indexOf(cur);
  switch (key) {
    case 'Home': return 0;
    case 'End': return items.length - 1;
    case 'ArrowLeft': return Math.max(0, at - 1);
    case 'ArrowRight': return Math.min(items.length - 1, at + 1);
    case 'PageUp': return Math.max(0, at - 10);
    case 'PageDown': return Math.min(items.length - 1, at + 10);
    case 'ArrowDown': case 'ArrowUp': {
      // the neighbouring row's item in the same column (or its last one when that row is shorter)
      const step = key === 'ArrowDown' ? 1 : -1;
      let j = at + step;
      while (j >= 0 && j < items.length && items[j].row === cur.row) j += step;
      if (j < 0 || j >= items.length) return at;
      const inRow = items.filter((x) => x.row === items[j].row);
      return items.indexOf(inRow[Math.min(cur.col, inRow.length - 1)]);
    }
  }
}

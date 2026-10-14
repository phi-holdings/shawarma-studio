import { expect, test } from 'vitest';
import { LIMITS, parseReply, parseSounds } from '../runtime/protocol';
import { bankName, soundCatalog, variantCount } from './catalog';
import { projectSampleMap, sampleMapUrlOk } from './projectSamples';
import { fuzzyScore, matchFields } from './fuzzy';
import { soundsInCode, usedSoundNames } from './usage';
import { bankInsertText, buildRows, buildSections, filterCounts, folderNameFor, insertTextFor, moveIndex, toSound, visibleRange } from './model';

// ---- protocol ----
test('listSounds reply: valid entries come back as fresh copies', () => {
  const src = [
    { name: 'rolandtr808_bd', type: 'drum-machine', bank: 'RolandTR808', count: 4, tags: ['tr808'] },
    { name: 'sawtooth', type: 'synth', count: 1 },
    { name: 'gm_piano', type: 'soundfont', count: 3 },
    { name: 'casio', type: 'sample', count: 3, extra: 'dropped' },
  ];
  const r = parseReply('listSounds', src);
  expect(r?.value).toEqual([
    { name: 'rolandtr808_bd', type: 'drum-machine', bank: 'RolandTR808', count: 4, tags: ['tr808'] },
    { name: 'sawtooth', type: 'synth', count: 1 },
    { name: 'gm_piano', type: 'soundfont', count: 3 },
    { name: 'casio', type: 'sample', count: 3 },
  ]);
  expect(r!.value[0]).not.toBe(src[0]);
  expect(r!.value[0].tags).not.toBe(src[0].tags);
});

test('listSounds reply: anything off rejects the whole list', () => {
  const ok = { name: 'bd', type: 'sample', count: 1 };
  const bad: [string, unknown][] = [
    ['not an array', { 0: ok }],
    ['quote in a name', { ...ok, name: 'bd")' }],
    ['html in a name', { ...ok, name: '<img>' }],
    ['empty name', { ...ok, name: '' }],
    ['long name', { ...ok, name: 'x'.repeat(101) }],
    ['unknown type', { ...ok, type: 'wavetable' }],
    ['negative count', { ...ok, count: -1 }],
    ['fractional count', { ...ok, count: 1.5 }],
    ['huge count', { ...ok, count: LIMITS.soundVariants + 1 }],
    ['bad bank', { ...ok, bank: 'a b' }],
    ['too many tags', { ...ok, tags: Array.from({ length: LIMITS.soundTags + 1 }, (_, i) => `t${i}`) }],
    ['bad tag', { ...ok, tags: ['ok', '"'] }],
    ['null entry', null],
  ];
  for (const [what, e] of bad) expect(parseSounds(what === 'not an array' ? e : [ok, e]), what).toBeNull();
  expect(parseSounds(Array.from({ length: LIMITS.sounds + 1 }, () => ok))).toBeNull();
  expect(parseSounds([])).toEqual([]);
});

test('loadSamples / audition replies', () => {
  expect(parseReply('loadSamples', { names: ['kick', 'snare'] })?.value).toEqual({ names: ['kick', 'snare'] });
  expect(parseReply('loadSamples', { names: ['ki"ck'] })).toBeNull();
  expect(parseReply('loadSamples', { names: 'kick' })).toBeNull();
  expect(parseReply('audition', null)?.value).toBeNull();
  expect(parseReply('audition', { boom: 1 })).toBeNull();
  expect(parseReply('auditionStop', null)?.value).toBeNull();
});

// ---- catalog (runs in the runtime) ----
test('catalog: types, counts, banks with their original case, aliases folded into tags', () => {
  const tr808bd = { data: { type: 'sample', tag: 'drum-machines', samples: ['https://cdn/x/RolandTR808/rolandtr808-bd/Bd0000.wav', 'b'] } };
  const map = {
    rolandtr808_bd: tr808bd,
    bd: { data: { type: 'sample', tag: 'drum-machines', samples: ['bd/1.wav', 'bd/2.wav', 'bd/3.wav'] } },
    casio: { data: { type: 'sample', samples: ['a', 'b', 'c'] } },
    piano: { data: { type: 'sample', samples: { A0: 'A0.mp3', C1: ['C1.mp3'] } } },
    sawtooth: { data: { type: 'synth' } },
    gm_piano: { data: { type: 'soundfont', fonts: [1, 2, 3] } },
    wt_digital: { data: { type: 'wavetable', tables: ['a', 'b'] } },
    bus: { data: { type: 'input' } },
    _hidden: { data: { type: 'synth' } },
    'bad"name': { data: { type: 'synth' } },
    tr808_bd: tr808bd,               // aliasBank copies the same entry
  };
  expect(soundCatalog(map)).toEqual([
    { name: 'bd', type: 'drum-machine', count: 3 },
    { name: 'casio', type: 'sample', count: 3 },
    { name: 'gm_piano', type: 'soundfont', count: 3 },
    { name: 'piano', type: 'sample', count: 1, tags: ['pitched'] },
    { name: 'rolandtr808_bd', type: 'drum-machine', bank: 'RolandTR808', count: 2, tags: ['tr808'] },
    { name: 'sawtooth', type: 'synth', count: 1 },
    { name: 'wt_digital', type: 'synth', count: 2, tags: ['wavetable'] },
  ]);
  // what the runtime sends passes the parent's check
  expect(parseSounds(soundCatalog(map))).not.toBeNull();
  expect(variantCount({ c: ['a', 'b'], d: 'x' })).toBe(2);
  expect(bankName('mridangam', ['https://cdn/norm_sounds/gumki/1.wav'])).toBe('mridangam');
});

// ---- project samples in the runtime ----
test('project sample map: local server URL only; relative files, cache-busted by version', () => {
  expect(sampleMapUrlOk('http://127.0.0.1:8787/samples/abc/demo/strudel.json')).toBe(true);
  expect(sampleMapUrlOk('http://localhost:8787/samples/abc/demo/strudel.json')).toBe(true);
  expect(sampleMapUrlOk('https://evil.example/strudel.json')).toBe(false);
  expect(sampleMapUrlOk('http://127.0.0.1:8787/samples/abc/demo/x.wav')).toBe(false);
  expect(sampleMapUrlOk('http://user:pw@127.0.0.1:8787/strudel.json')).toBe(false);
  expect(sampleMapUrlOk('not a url')).toBe(false);
  expect(projectSampleMap({
    Kick: ['kick/a.wav', 'kick/b.wav'],
    bad: ['https://evil.example/x.wav', '/etc/passwd', '../../x.wav', 'ok/c.wav'],
    _base: 'https://evil.example/',
    'x"y': ['x/y.wav'],
    empty: [],
    notArray: 'kick/a.wav',
  }, 'v1')).toEqual({ kick: ['kick/a.wav?v=v1', 'kick/b.wav?v=v1'], bad: ['ok/c.wav?v=v1'] });
  expect(projectSampleMap(null)).toEqual({});
  expect(projectSampleMap(['a'])).toEqual({});
});

// ---- search ----
test('fuzzy: prefix beats substring beats subsequence; misses are null', () => {
  const prefix = fuzzyScore('tr8', 'tr808')!;
  const sub = fuzzyScore('808', 'rolandtr808')!;
  const subseq = fuzzyScore('rld', 'roland')!;
  expect(prefix).toBeGreaterThan(sub);
  expect(sub).toBeGreaterThan(subseq);
  expect(subseq).toBeGreaterThan(0);
  expect(fuzzyScore('xyz', 'roland')).toBeNull();
  expect(fuzzyScore('', 'x')).toBe(0);
  expect(matchFields('808 bd', ['rolandtr808_bd', 'bd', 'RolandTR808'])).not.toBeNull();
  expect(matchFields('808 piano', ['rolandtr808_bd', 'bd'])).toBeNull();
});

// ---- used in this song ----
test('usage: s()/sound() words and .bank() names, comments ignored, bank aliases resolved', () => {
  const code = `// s("cp")\nsetcps(1)\n$: s("bd*2 [sd hh:3]").bank('RolandTR808')\n$: note("c e").sound(\`piano\`)\n$: n("0 2").s("gm_piano")\n/* s("oh") */`;
  const { words, banks } = soundsInCode(code);
  expect([...words].sort()).toEqual(['bd', 'gm_piano', 'hh', 'piano', 'sd']);
  expect([...banks]).toEqual(['rolandtr808']);
  const available = new Set(['bd', 'rolandtr808_bd', 'rolandtr808_sd', 'piano', 'gm_piano', 'cp', 'oh', 'sawtooth']);
  expect([...usedSoundNames(code, available)].sort()).toEqual(['bd', 'gm_piano', 'piano', 'rolandtr808_bd', 'rolandtr808_sd']);
  expect([...usedSoundNames('s("bd").bank("tr808")', available, new Map([['tr808', 'rolandtr808']]))].sort()).toEqual(['bd', 'rolandtr808_bd']);
});

// ---- view model ----
const catalog = [
  { name: 'bd', type: 'drum-machine' as const, count: 3 },
  { name: 'rolandtr808_bd', type: 'drum-machine' as const, bank: 'RolandTR808', count: 2, tags: ['tr808'] },
  { name: 'rolandtr808_hh', type: 'drum-machine' as const, bank: 'RolandTR808', count: 1 },
  { name: 'rolandtr808_sd', type: 'drum-machine' as const, bank: 'RolandTR808', count: 1 },
  { name: 'rolandtr909_bd', type: 'drum-machine' as const, bank: 'RolandTR909', count: 1 },
  { name: 'casio', type: 'sample' as const, count: 3 },
  { name: 'piano', type: 'sample' as const, count: 1, tags: ['pitched'] },
  { name: 'sawtooth', type: 'synth' as const, count: 1 },
  { name: 'gm_piano', type: 'soundfont' as const, count: 3 },
  { name: 'kick', type: 'sample' as const, count: 2, tags: ['project'] },
];
const project = [{ name: 'kick', label: 'kick', type: 'sample' as const, count: 2, project: true }];

test('insert text fits the sound', () => {
  const s = (name: string) => toSound(catalog.find((c) => c.name === name)!);
  expect(insertTextFor(s('rolandtr808_bd'))).toBe('s("bd").bank("RolandTR808")');
  expect(insertTextFor(s('rolandtr808_bd'), 1)).toBe('s("bd:1").bank("RolandTR808")');
  expect(insertTextFor(s('bd'))).toBe('s("bd")');
  expect(insertTextFor(s('casio'), 2)).toBe('s("casio:2")');
  expect(insertTextFor(s('piano'))).toBe('note("c3").s("piano")');
  expect(insertTextFor(s('sawtooth'))).toBe('note("c3").s("sawtooth")');
  expect(insertTextFor(s('gm_piano'))).toBe('note("c3").s("gm_piano")');
  expect(insertTextFor(project[0])).toBe('s("kick")');
  const tr808 = ['rolandtr808_bd', 'rolandtr808_hh', 'rolandtr808_sd'].map(s);
  expect(bankInsertText('RolandTR808', tr808)).toBe('s("bd hh sd hh").bank("RolandTR808")');
  expect(bankInsertText('RolandTR909', [s('rolandtr909_bd')])).toBe('s("bd").bank("RolandTR909")');
});

test('folder names for dropped files match the server rules', () => {
  expect(folderNameFor('Big Kick 01.wav')).toBe('big_kick_01');
  expect(folderNameFor('808.wav')).toBeNull();
  expect(folderNameFor('')).toBeNull();
  expect(folderNameFor('My Kicks')).toBe('my_kicks');
});

test('sections: used first, project samples apart, drums grouped by bank, filters and search', () => {
  const used = new Set(['rolandtr808_bd', 'kick']);
  const all = buildSections({ catalog, project, used, query: '', filter: 'all' });
  expect(all.map((s) => s.id)).toEqual(['used', 'project', 'drums', 'samples', 'synths', 'instruments']);
  expect(all[0].sounds!.map((s) => s.name)).toEqual(['kick', 'rolandtr808_bd']);
  const drums = all.find((s) => s.id === 'drums')!;
  expect(drums.groups!.map((g) => g.bank)).toEqual(['', 'RolandTR808', 'RolandTR909']);
  expect(drums.groups![1].sounds.map((s) => s.label)).toEqual(['bd', 'sd', 'hh']);   // drummer order
  // the project's own samples are not repeated under Sample sets
  expect(all.find((s) => s.id === 'samples')!.sounds!.map((s) => s.name)).toEqual(['casio', 'piano']);

  expect(buildSections({ catalog, project, used: new Set(), query: '', filter: 'synths' }).map((s) => s.id)).toEqual(['synths']);
  expect(buildSections({ catalog, project, used: new Set(), query: '', filter: 'samples' }).map((s) => s.id)).toEqual(['project', 'samples']);

  const searched = buildSections({ catalog, project, used: new Set(), query: 'tr808', filter: 'all' });
  expect(searched.find((s) => s.id === 'drums')!.groups!.map((g) => g.bank)).toEqual(['RolandTR808']); // by alias tag too
  expect(searched.find((s) => s.id === 'samples')!.sounds).toEqual([]);
  const piano = buildSections({ catalog, project, used: new Set(), query: 'piano', filter: 'all' });
  expect(piano.find((s) => s.id === 'instruments')!.sounds!.map((s) => s.name)).toEqual(['gm_piano']);

  expect(filterCounts(catalog, project, '')).toEqual({ all: 10, drums: 5, samples: 3, synths: 1, instruments: 1 });
  expect(filterCounts(catalog, project, 'piano')).toEqual({ all: 2, drums: 0, samples: 1, synths: 0, instruments: 1 });
});

test('rows: pads wrap by column count, collapsed sections, windowing and keyboard moves', () => {
  const sections = buildSections({ catalog, project, used: new Set(), query: '', filter: 'drums' });
  const m = buildRows(sections, { columns: 2, collapsed: new Set(), hasProject: true, query: '' });
  expect(m.rows.map((r) => r.kind)).toEqual(['section', 'bank', 'pads', 'bank', 'pads', 'pads', 'bank', 'pads']);
  expect(m.items.map((i) => `${i.sound.name}@${i.row}.${i.col}`)).toEqual([
    'bd@2.0', 'rolandtr808_bd@4.0', 'rolandtr808_sd@4.1', 'rolandtr808_hh@5.0', 'rolandtr909_bd@7.0',
  ]);
  expect(m.offsets[1]).toBe(40);
  expect(m.height).toBe(40 + 38 * 3 + 66 * 4);
  // down from the 808's sd (col 1) lands on hh (the shorter row's last pad); up from hh (col 0) on the 808's bd
  expect(moveIndex(m.items, 2, 'ArrowDown')).toBe(3);
  expect(moveIndex(m.items, 3, 'ArrowUp')).toBe(1);
  expect(moveIndex(m.items, 1, 'ArrowRight')).toBe(2);
  expect(moveIndex(m.items, 0, 'ArrowUp')).toBe(0);
  expect(moveIndex(m.items, 4, 'ArrowDown')).toBe(4);
  expect(moveIndex(m.items, 2, 'End')).toBe(4);
  expect(moveIndex([], 0, 'ArrowDown')).toBe(-1);

  const folded = buildRows(sections, { columns: 2, collapsed: new Set(['drums']), hasProject: true, query: '' });
  expect(folded.rows.map((r) => r.kind)).toEqual(['section']);
  expect(folded.items).toEqual([]);
  // a search opens collapsed sections
  expect(buildRows(sections, { columns: 2, collapsed: new Set(['drums']), hasProject: true, query: 'bd' }).items.length).toBe(5);

  const noProject = buildRows(buildSections({ catalog, project: [], used: new Set(), query: '', filter: 'samples' }), { columns: 4, collapsed: new Set(), hasProject: false, query: '' });
  expect(noProject.rows.slice(0, 2).map((r) => r.kind)).toEqual(['section', 'note']);
  const withProject = buildRows(buildSections({ catalog, project, used: new Set(), query: '', filter: 'samples' }), { columns: 4, collapsed: new Set(), hasProject: true, query: '' });
  expect(withProject.rows.slice(0, 3).map((r) => r.kind)).toEqual(['section', 'sound', 'drop']);

  // windowing: a big list only renders what is near the viewport
  const offsets = Array.from({ length: 1000 }, (_, i) => i * 44);
  expect(visibleRange(offsets, 0, 440, 0)).toEqual([0, 10]);
  expect(visibleRange(offsets, 44 * 500 + 10, 440, 2)).toEqual([498, 513]);
  expect(visibleRange([], 0, 100)).toEqual([0, 0]);
});

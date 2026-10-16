import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createCheckApp } from '../app';
import { functionEntry, inferName, parseJsDoc } from './jsdoc';
import { docEntries, mdxToMarkdown } from './mdx';
import { ReferenceIndex, shippedReference } from './search';
import { MAX_ENTRY_CHARS, type ReferenceFile } from './types';

const fixture = (f: string) => readFileSync(new URL(`../../fixtures/strudel/${f}`, import.meta.url), 'utf8');
const COMMIT = '0a6d61e14a37ad6f3c687c4b0397c8fbf57f37ca';

test('JSDoc: names, synonyms, params and examples', () => {
  const docs = parseJsDoc(fixture('controls.mjs'), 'packages/core/controls.mjs');
  expect(docs.map((d) => d.name)).toEqual(['s', 'delay', 'delayfeedback', 'delayspeed', 'delaytime']);
  const fb = docs.find((d) => d.name === 'delayfeedback')!;
  expect(fb.synonyms).toEqual(['delayfb', 'dfb']);
  expect(fb.params).toEqual([{ name: 'feedback', type: 'number | Pattern', description: 'between 0 and 1' }]);
  expect(fb.examples).toEqual(['s("bd").delay(.25).delayfeedback("<.25 .5 .75 1>")']);
});

test('JSDoc: a block without @name takes the name from the code after it', () => {
  const docs = parseJsDoc(fixture('pattern.mjs'), 'packages/core/pattern.mjs');
  expect(docs.map((d) => d.name)).toEqual(['fast', 'hurry']);
  expect(inferName('\nexport function stack(...pats) {')).toBe('stack');
  const fast = functionEntry(docs[0], COMMIT);
  expect(fast.content.startsWith('fast (also: density)\n')).toBe(true);
  expect(fast.synonyms).toEqual(['density']);
});

test('function entry: text, licence and source link', () => {
  const [, delay] = parseJsDoc(fixture('controls.mjs'), 'packages/core/controls.mjs');
  const e = functionEntry(delay, COMMIT);
  expect(e).toMatchObject({ kind: 'function', ref: 'function:delay', name: 'delay', title: 'delay: Sets the level of the delay signal.' });
  expect(e.content).toContain('Example:\ns("bd bd").delay("<0 .25 .5 1>")');
  expect(e.source).toBe(`https://codeberg.org/uzu/strudel/src/commit/${COMMIT}/packages/core/controls.mjs#L${delay.line} (AGPL-3.0, Strudel)`);
});

test('MDX: one entry per section, code kept, JsDoc-only sections skipped', () => {
  const entries = docEntries(fixture('effects.mdx'), 'learn/effects.mdx', COMMIT);
  const refs = entries.map((c) => c.ref);
  expect(refs).toContain('doc:learn/effects.mdx#continuous-changes');
  expect(refs).not.toContain('doc:learn/effects.mdx#lpf');
  const cont = entries.find((c) => c.ref === 'doc:learn/effects.mdx#continuous-changes')!;
  expect(cont.title).toBe('Audio effects: Continuous changes');
  expect(cont.content).toContain('```js\ns("supersaw").seg(16).lpf(tri.range(100, 5000).slow(2))\n```');
  expect(cont.content).not.toMatch(/<MiniRepl|client:visible/);
  for (const c of entries) expect(c.content.length).toBeLessThanOrEqual(MAX_ENTRY_CHARS);
  expect(mdxToMarkdown(fixture('effects.mdx')).title).toBe('Audio effects');
});

test('BM25: a word in the title or name outranks the same word in the content; kinds filter; plurals match', () => {
  const idx = new ReferenceIndex([
    { kind: 'doc', ref: 'doc:a', title: 'Other page', content: 'a long text that mentions reverb once', source: 's' },
    { kind: 'function', ref: 'function:room', name: 'room', synonyms: ['reverb'], title: 'room: Reverb amount', content: 'room\nSets the reverb level', source: 's' },
    { kind: 'doc', ref: 'doc:b', title: 'Delays', content: 'echo feedback', source: 's' },
  ]);
  expect(idx.search('make the reverb wetter').map((h) => h.ref)).toEqual(['function:room', 'doc:a']);
  expect(idx.search('reverb', { kinds: ['doc'] }).map((h) => h.ref)).toEqual(['doc:a']);
  expect(idx.search('delay')[0].ref).toBe('doc:b');
  expect(idx.search('the and of')).toEqual([]);
  expect(idx.search('reverb')[0].why).toContain('reverb');
});

test('the shipped reference: licence note, no example tunes, finds lpf', () => {
  const file = JSON.parse(readFileSync(new URL('../../reference/strudel-reference.json', import.meta.url), 'utf8')) as ReferenceFile;
  expect(file.license).toBe('AGPL-3.0, Strudel');
  expect(file.generatedFrom.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(new Set(file.entries.map((e) => e.kind))).toEqual(new Set(['function', 'doc']));
  expect(file.entries.some((e) => e.ref.startsWith('example:'))).toBe(false);
  expect(new Set(file.entries.map((e) => e.ref)).size).toBe(file.entries.length);
  expect(shippedReference().search('low pass filter cutoff', { kinds: ['function'] }).map((h) => h.ref)).toContain('function:lpf');
});

test('hosted packs: the reference leaves out entries that use drum machines, wavetables or Dirt sounds', () => {
  const all = shippedReference('all');
  const hosted = shippedReference('hosted');
  expect(hosted.size).toBeLessThan(all.size);
  expect(all.size - hosted.size).toBeLessThan(50);   // a few dozen examples, not whole topics
  const refs = (idx: ReturnType<typeof shippedReference>, q: string) => idx.search(q, { limit: 10 }).map((h) => h.ref);
  expect(refs(all, 'bank RolandTR909')).toContain('function:bank');
  expect(refs(hosted, 'bank RolandTR909')).not.toContain('function:bank');
  for (const q of ['bank tr909 drum machine', 'wavetable wt_digital', 'casio sample']) {
    for (const h of hosted.search(q, { limit: 10 })) expect(h.content).not.toMatch(/\.bank\(\s*["'`](?!mridangam)/i);
  }
  expect(refs(hosted, 'low pass filter cutoff')).toContain('function:lpf');
});

test('GET /reference: results shape, filters and bad input', async () => {
  const app = createCheckApp({ key: 'k' });
  const get = (qs: string, key = 'k') => app.request(`/reference${qs}`, { headers: { 'x-check-key': key } });
  const r = await (await get('?q=lowpass+filter&limit=3&kinds=function')).json();
  expect(r.results.length).toBeGreaterThan(0);
  expect(r.results.length).toBeLessThanOrEqual(3);
  expect(Object.keys(r.results[0]).sort()).toEqual(['content', 'kind', 'ref', 'source', 'title', 'why']);
  expect(r.results.every((x: { kind: string }) => x.kind === 'function')).toBe(true);
  expect((await get('')).status).toBe(400);
  expect((await get('?q=x&kinds=song')).status).toBe(400);
  expect((await get('?q=x&limit=abc')).status).toBe(400);
  expect((await get('?q=lpf', 'bad')).status).toBe(403);
});

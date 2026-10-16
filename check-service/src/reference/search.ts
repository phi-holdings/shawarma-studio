// BM25 keyword search over the reference. Words in the title count more than words in the content.
import { readFileSync } from 'node:fs';
import { usesOnlySoundsOf, type SoundPackSet } from '@shawarma/shared';
import { SOUND_PACK_SET } from '../config';
import type { ReferenceEntry, ReferenceFile, ReferenceKind } from './types';

export interface ReferenceHit { kind: ReferenceKind; ref: string; title: string; source: string; content: string; why: string }

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'how', 'do', 'does', 'i', 'my', 'is', 'it', 'me', 'make', 'use', 'using', 'what', 'can', 'like', 'some', 'that', 'this', 'by', 'at', 'be', 'from', 'into']);

/** Lower-case word and code-identifier tokens (camelCase and underscore names are split too). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    const w = raw.toLowerCase();
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(w);
    const parts = raw.split(/(?<=[a-z])(?=[A-Z])|_/).map((p) => p.toLowerCase()).filter((p) => p.length > 1);
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

/** The query's search words (stop words dropped). */
export function queryWords(query: string): string[] {
  return [...new Set(tokens(query).filter((w) => !STOP.has(w)))];
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;   // a word in the title counts as this many in the content
const NAME_WEIGHT = 6;    // ... and in a function's own name or synonyms

interface Doc { entry: ReferenceEntry; tf: Map<string, number>; len: number }

const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export class ReferenceIndex {
  private docs: Doc[];
  private df = new Map<string, number>();
  private avg: number;

  constructor(entries: ReferenceEntry[]) {
    this.docs = entries.map((entry) => {
      const tf = new Map<string, number>();
      const add = (text: string, weight: number) => { for (const t of tokens(text)) tf.set(stem(t), (tf.get(stem(t)) ?? 0) + weight); };
      add(entry.content, 1);
      add(entry.title, TITLE_WEIGHT);
      if (entry.name) add(`${entry.name} ${(entry.synonyms ?? []).join(' ')}`, NAME_WEIGHT);
      return { entry, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / (this.docs.length || 1);
  }

  get size(): number { return this.docs.length; }

  search(query: string, opts: { limit?: number; kinds?: ReferenceKind[] } = {}): ReferenceHit[] {
    const limit = Math.max(1, Math.min(10, Math.floor(opts.limit ?? 5)));
    const words = queryWords(query).map(stem);
    if (!words.length) return [];
    const n = this.docs.length;
    const scored: { d: Doc; score: number; hit: string[] }[] = [];
    for (const d of this.docs) {
      if (opts.kinds?.length && !opts.kinds.includes(d.entry.kind)) continue;
      let score = 0;
      const hit: string[] = [];
      for (const w of words) {
        const f = d.tf.get(w);
        if (!f) continue;
        const df = this.df.get(w) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avg)));
        hit.push(w);
      }
      if (score > 0) scored.push({ d, score, hit });
    }
    scored.sort((a, b) => b.score - a.score || a.d.entry.ref.localeCompare(b.d.entry.ref));
    return scored.slice(0, limit).map(({ d, hit }) => ({
      kind: d.entry.kind,
      ref: d.entry.ref,
      title: d.entry.title,
      source: d.entry.source,
      content: d.entry.content,
      why: `words ${hit.join(', ')}`,
    }));
  }
}

const shipped = new Map<SoundPackSet, ReferenceIndex>();

/**
 * The index over the generated reference/strudel-reference.json (loaded once per pack set). With the
 * hosted packs (SOUND_PACKS=hosted), entries whose text uses a sound outside them (drum-machine banks,
 * wavetables, Dirt-Samples names) are left out, so the assistant is not shown sounds it cannot use.
 */
export function shippedReference(set: SoundPackSet = SOUND_PACK_SET): ReferenceIndex {
  let index = shipped.get(set);
  if (!index) {
    const file = JSON.parse(readFileSync(new URL('../../reference/strudel-reference.json', import.meta.url), 'utf8')) as ReferenceFile;
    index = new ReferenceIndex(file.entries.filter((e) => usesOnlySoundsOf(e.content, set)));
    shipped.set(set, index);
  }
  return index;
}

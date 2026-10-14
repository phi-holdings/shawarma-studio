// Strudel's function reference, read straight from the JSDoc in strudel/packages/*/*.mjs (the same
// comments its jsdoc-json build turns into the website reference): name, @synonyms, description, @params
// and @example blocks. One chunk per function.
import { MAX_ENTRY_CHARS, STRUDEL_LICENSE, strudelUrl, type ReferenceEntry } from './types';

export interface FunctionDoc {
  name: string;
  synonyms: string[];
  description: string;
  params: { name: string; type: string; description: string }[];
  examples: string[];
  tags: string[];
  /** Path inside the Strudel repo, e.g. packages/core/controls.mjs, and the line of the comment. */
  file: string;
  line: number;
}

const stripHtml = (s: string) =>
  s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:p|code|em|strong|b|i|ul|li|a)(?:\s[^>]*)?>/gi, '').replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, '$1');

/** The name a JSDoc block documents when it has no @name: taken from the code right after it. */
export function inferName(after: string): string | null {
  const line = after.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//'));
  if (!line) return null;
  const pats = [
    /^export\s+const\s+\{\s*([\w$]+)/,
    /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/,
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/,
    /^Pattern\.prototype\.([\w$]+)\s*=/,
    /^(?:static\s+)?(?:async\s+)?([\w$]+)\s*\(/,
    /^([\w$]+)\s*:/,
  ];
  for (const p of pats) { const m = line.match(p); if (m) return m[1]; }
  return null;
}

/** All documented functions in one source file. */
export function parseJsDoc(source: string, file: string): FunctionDoc[] {
  const out: FunctionDoc[] = [];
  for (const m of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const body = m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n');
    const after = source.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
    const line = source.slice(0, m.index!).split('\n').length;
    const [descPart, ...tagParts] = body.split(/\n(?=@\w)/);
    const startsWithTag = /^\s*@\w/.test(descPart);
    const tagsText = startsWithTag ? [descPart, ...tagParts] : tagParts;
    const description = startsWithTag ? '' : stripHtml(descPart).replace(/\n{3,}/g, '\n\n').trim();
    let name: string | null = null;
    const doc: Omit<FunctionDoc, 'name'> = { synonyms: [], description, params: [], examples: [], tags: [], file, line };
    let skip = false;
    for (const t of tagsText) {
      const tm = t.match(/^\s*@(\w+)\s?([\s\S]*)$/);
      if (!tm) continue;
      const [, tag, rest] = tm;
      const value = rest.replace(/\s+$/, '');
      switch (tag) {
        case 'name': name = value.trim().split(/\s+/)[0]; break;
        case 'synonyms': doc.synonyms.push(...value.split(/[\s,]+/).filter(Boolean)); break;
        case 'tags': case 'tag': doc.tags.push(...value.split(/[\s,]+/).filter(Boolean)); break;
        case 'example': if (value.trim()) doc.examples.push(value.replace(/^\n+/, '')); break;
        case 'param': {
          const p = value.match(/^\{([^}]*)\}\s+\[?([\w$.]+)[^\s]*\s*([\s\S]*)$/);
          if (p) doc.params.push({ type: p[1].trim(), name: p[2], description: stripHtml(p[3]).replace(/\s+/g, ' ').trim() });
          break;
        }
        case 'private': case 'deprecated': skip = true; break;
      }
    }
    name ??= inferName(after);
    if (skip || !name || name.startsWith('_')) continue;
    if (!doc.description && doc.examples.length === 0) continue;
    out.push({ name, ...doc });
  }
  return out;
}

/** Same name documented twice (e.g. in two packages): keep the fuller entry. */
export function dedupeDocs(docs: FunctionDoc[]): FunctionDoc[] {
  const by = new Map<string, FunctionDoc>();
  const size = (d: FunctionDoc) => d.description.length + d.examples.join('').length;
  for (const d of docs) {
    const prev = by.get(d.name);
    if (!prev || size(d) > size(prev)) by.set(d.name, d);
  }
  return [...by.values()];
}

function firstSentence(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  const m = one.match(/^(.{10,}?[.!?])(\s|$)/);
  const t = m ? m[1] : one;
  return t.length > 100 ? `${t.slice(0, 97)}...` : t;
}

export function functionEntry(d: FunctionDoc, commit: string): ReferenceEntry {
  const head = [`${d.name}${d.synonyms.length ? ` (also: ${d.synonyms.join(', ')})` : ''}`];
  if (d.description) head.push(d.description);
  if (d.params.length) head.push(`Parameters: ${d.params.map((p) => `${p.name} (${p.type})${p.description ? `: ${p.description}` : ''}`).join('; ')}`);
  let content = head.join('\n');
  if (content.length > MAX_ENTRY_CHARS - 200) content = `${content.slice(0, MAX_ENTRY_CHARS - 203)}...`;
  const used: string[] = [];
  for (const ex of d.examples) {
    const block = `\nExample:\n${ex}`;
    if (content.length + block.length > MAX_ENTRY_CHARS) break;
    content += block;
    used.push(ex);
  }
  return {
    kind: 'function',
    ref: `function:${d.name}`,
    name: d.name,
    synonyms: d.synonyms,
    description: d.description,
    examples: used,
    title: d.description ? `${d.name}: ${firstSentence(d.description)}` : d.name,
    content,
    source: `${strudelUrl(commit, d.file, d.line)} (${STRUDEL_LICENSE})`,
  };
}

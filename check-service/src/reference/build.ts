// Builds the reference from a local Strudel checkout: function reference (JSDoc in packages/*) and the
// learn/ and functions/ pages. No example tunes.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dedupeDocs, functionEntry, parseJsDoc, type FunctionDoc } from './jsdoc';
import { docEntries } from './mdx';
import { STRUDEL_LICENSE, STRUDEL_REPO_URL, type ReferenceEntry, type ReferenceFile } from './types';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', 'bench', '__tests__']);

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...(await sourceFiles(path.join(dir, e.name)))); }
    else if (/\.(mjs|js|jsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !/^vite\.config/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out.sort();
}

/** The commit a checkout is at, read from .git without running git. */
export async function readCommit(repo: string): Promise<string> {
  const head = (await readFile(path.join(repo, '.git/HEAD'), 'utf8')).trim();
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5);
  const loose = await readFile(path.join(repo, '.git', ref), 'utf8').catch(() => null);
  if (loose) return loose.trim();
  const packed = await readFile(path.join(repo, '.git/packed-refs'), 'utf8');
  const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
  if (!line) throw new Error(`Could not resolve ${ref} in ${repo}`);
  return line.split(' ')[0];
}

export async function functionDocs(strudel: string): Promise<FunctionDoc[]> {
  const docs: FunctionDoc[] = [];
  for (const f of await sourceFiles(path.join(strudel, 'packages'))) {
    docs.push(...parseJsDoc(await readFile(f, 'utf8'), path.relative(strudel, f)));
  }
  return dedupeDocs(docs);
}

export async function buildReference(strudel: string, commit: string): Promise<ReferenceFile> {
  const entries: ReferenceEntry[] = (await functionDocs(strudel)).map((d) => functionEntry(d, commit));
  const pages = path.join(strudel, 'website/src/pages');
  for (const sub of ['learn', 'functions']) {
    for (const f of (await readdir(path.join(pages, sub))).filter((n) => n.endsWith('.mdx')).sort()) {
      entries.push(...docEntries(await readFile(path.join(pages, sub, f), 'utf8'), `${sub}/${f}`, commit));
    }
  }
  // refs are unique; later duplicates get a suffix
  const seen = new Map<string, number>();
  for (const e of entries) {
    const n = (seen.get(e.ref) ?? 0) + 1;
    seen.set(e.ref, n);
    if (n > 1) e.ref = `${e.ref}~${n}`;
  }
  return {
    generatedFrom: { repo: STRUDEL_REPO_URL, commit },
    license: STRUDEL_LICENSE,
    note: 'Function reference and documentation text from Strudel (https://strudel.cc), licensed AGPL-3.0-or-later. Example tunes are not included.',
    entries,
  };
}

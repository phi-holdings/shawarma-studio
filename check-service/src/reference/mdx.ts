// Strudel's learn/ and functions/ pages (MDX): one chunk per `#`/`##` section, code kept. MiniRepl
// examples become js code blocks; sections that only embed function reference entries (<JsDoc name=.../>)
// are skipped because the function chunks already cover them.
import { MAX_ENTRY_CHARS, STRUDEL_LICENSE, slug, strudelUrl, type ReferenceEntry } from './types';

const unescapeTune = (s: string) => s.replace(/\\([`*$\\])/g, '$1').replace(/^\n+/, '').replace(/\s+$/, '');

/** MDX body -> markdown with code blocks: imports, frontmatter and JSX dropped, examples kept as code. */
export function mdxToMarkdown(mdx: string): { title: string | null; markdown: string; codes: string[] } {
  let title: string | null = null;
  let text = mdx.replace(/^---\n([\s\S]*?)\n---\n/, (_, fm: string) => {
    title = fm.match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '') ?? null;
    return '';
  });
  const codes: string[] = [];
  const tune = (code: string) => { codes.push(code); return `\n\`\`\`js\n${code}\n\`\`\`\n`; };
  text = text
    .replace(/^import\s.+$/gm, '')
    .replace(/<MiniRepl\b[\s\S]*?tune=\{`([\s\S]*?)`\}[\s\S]*?\/>/g, (_, c: string) => tune(unescapeTune(c)))
    .replace(/<MiniRepl\b[\s\S]*?tune=\{(['"])([\s\S]*?)\1\}[\s\S]*?\/>/g, (_, _q: string, c: string) => tune(unescapeTune(c)))
    .replace(/<JsDoc\b[^>]*\bname=["']([^"']+)["'][^>]*\/>/g, '\u0000jsdoc:$1\u0000')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n');
  return { title, markdown: text.trim(), codes };
}

interface Section { heading: string | null; body: string }

/** Split at `#` and `##` headings outside code fences. */
export function splitSections(markdown: string): Section[] {
  const out: Section[] = [{ heading: null, body: '' }];
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const h = !fence && line.match(/^#{1,2}\s+(.+?)\s*#*$/);
    if (h) out.push({ heading: h[1].trim(), body: '' });
    else out[out.length - 1].body += `${line}\n`;
  }
  return out.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.heading || s.body);
}

/** Paragraph-sized parts of at most `max` chars, never cutting a code block (a lone long block is cut). */
export function splitParagraphs(body: string, max = MAX_ENTRY_CHARS): string[] {
  const blocks: string[] = [];
  let fence = false;
  let cur = '';
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    cur += `${line}\n`;
    if (!fence && line.trim() === '') { blocks.push(cur); cur = ''; }
  }
  if (cur) blocks.push(cur);
  // a block larger than a chunk (a long list) is split at line ends
  const sized = blocks.flatMap((b) => {
    if (b.length <= max) return [b];
    const out: string[] = [];
    let piece = '';
    for (const line of b.split(/(?<=\n)/)) {
      if (piece && piece.length + line.length > max) { out.push(piece); piece = ''; }
      piece += line;
    }
    if (piece) out.push(piece);
    return out;
  });
  const parts: string[] = [];
  let part = '';
  for (const b of sized) {
    if (part && part.length + b.length > max) { parts.push(part.trim()); part = ''; }
    part += b;
  }
  if (part.trim()) parts.push(part.trim());
  return parts.map((p) => (p.length > max ? `${p.slice(0, max - 4)}\n...` : p));
}

/** `relPath` is the page inside website/src/pages, e.g. "learn/effects.mdx". */
export function docEntries(mdx: string, relPath: string, commit: string): ReferenceEntry[] {
  const { title: pageTitle, markdown } = mdxToMarkdown(mdx);
  const page = pageTitle ?? relPath.replace(/\.mdx$/, '');
  const used = new Map<string, number>();
  const chunks: ReferenceEntry[] = [];
  for (const sec of splitSections(markdown)) {
    const onlyRefs = sec.body.replace(/\u0000jsdoc:[^\u0000]+\u0000/g, '').trim() === '';
    if (onlyRefs) continue;   // a bare <JsDoc name="lpf"/>: the function chunk has it
    const body = sec.body.replace(/\u0000jsdoc:([^\u0000]+)\u0000/g, '(see the function reference for `$1`)');
    const heading = sec.heading ?? page;
    let anchor = slug(sec.heading ?? 'intro');
    const n = (used.get(anchor) ?? 0) + 1;
    used.set(anchor, n);
    if (n > 1) anchor = `${anchor}-${n}`;
    const parts = splitParagraphs(body, MAX_ENTRY_CHARS - heading.length - 4);
    parts.forEach((p, i) => {
      chunks.push({
        kind: 'doc',
        ref: `doc:${relPath}#${anchor}${parts.length > 1 ? `/${i + 1}` : ''}`,
        title: sec.heading && sec.heading.toLowerCase() !== page.toLowerCase() ? `${page}: ${sec.heading}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}` : page,
        content: `# ${heading}\n${p}`,
        source: `${strudelUrl(commit, `website/src/pages/${relPath}`)} (${STRUDEL_LICENSE})`,
      });
    });
  }
  return chunks;
}

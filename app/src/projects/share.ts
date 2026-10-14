// strudel.cc share links. Same encoding as Strudel's own `code2hash` / `hash2code`
// (strudel/packages/core/util.mjs, used by shareCode in strudel/website/src/repl/util.mjs):
// UTF-8 bytes -> base64 -> encodeURIComponent, after "https://strudel.cc/#".

export const STRUDEL_ORIGIN = 'https://strudel.cc/';

export function unicodeToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToUnicode(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const code2hash = (code: string) => encodeURIComponent(unicodeToBase64(code));
export const hash2code = (hash: string) => base64ToUnicode(decodeURIComponent(hash));

/** The long strudel.cc link for a song: it carries the whole code, no server involved. */
export const strudelLink = (code: string) => `${STRUDEL_ORIGIN}#${code2hash(code)}`;

export class ImportError extends Error {}

/**
 * The code in a strudel.cc link (`https://strudel.cc/#<base64>`, also a bare `#<base64>` hash).
 * Short links (`strudel.cc/?abc123`) live in Strudel's database and cannot be read here.
 */
export function codeFromStrudelLink(input: string): string {
  const text = input.trim();
  if (!text) throw new ImportError('Paste a strudel.cc link first.');
  const hashAt = text.indexOf('#');
  if (hashAt < 0) {
    if (/strudel\.cc\/?\?/.test(text)) throw new ImportError('That is a short strudel.cc link, which only Strudel can read. In Strudel, open it and use "copy link" with the long form, or copy the code itself.');
    throw new ImportError('That does not look like a strudel.cc link. It should look like https://strudel.cc/#c291bmQoImJkIik%3D');
  }
  const hash = text.slice(hashAt + 1);
  let code: string;
  try {
    code = hash2code(hash);
  } catch {
    throw new ImportError('The link is damaged: the part after # is not valid. Copy the whole link again.');
  }
  if (!code.trim()) throw new ImportError('That link has no code in it.');
  return code;
}

/** A project name for imported code: the file name without extension, else a dated default. */
export function importName(fileName?: string, now = new Date()): string {
  const base = fileName?.replace(/\.(strudel\.js|strudel|js|txt)$/i, '').trim();
  if (base) return base.slice(0, 100);
  return `Imported ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
}

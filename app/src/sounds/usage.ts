// Which loaded sounds a song uses, read from its code (a heuristic: string arguments of s()/sound()
// and .bank(); good enough to float those sounds to the top of the browser).

const QUOTED = String.raw`(["'\`])((?:\\.|(?!\1)[\s\S])*?)\1`;
const SOUND_CALL = new RegExp(String.raw`(?:^|[^\w$])(?:s|sound)\s*\(\s*` + QUOTED, 'g');
const BANK_CALL = new RegExp(String.raw`\.bank\s*\(\s*` + QUOTED, 'g');
const WORD = /[A-Za-z][\w.#-]*/g;

/** Drops // and /* *\/ comments (strings are left alone well enough for a heuristic). */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');

/** Sound words (lower-case, without `:n`) and bank names (lower-case) mentioned in the code. */
export function soundsInCode(code: string): { words: Set<string>; banks: Set<string> } {
  const src = stripComments(code);
  const words = new Set<string>();
  const banks = new Set<string>();
  for (const m of src.matchAll(SOUND_CALL)) for (const w of m[2].match(WORD) ?? []) words.add(w.toLowerCase());
  for (const m of src.matchAll(BANK_CALL)) for (const w of m[2].match(WORD) ?? []) banks.add(w.toLowerCase());
  return { words, banks };
}

/**
 * Names from `available` the code uses: each word itself, and `<bank>_<word>` for every bank mentioned
 * (`aliases` maps a bank alias such as `tr808` to the listed bank prefix `rolandtr808`).
 */
export function usedSoundNames(code: string, available: ReadonlySet<string>, aliases: ReadonlyMap<string, string> = new Map()): Set<string> {
  const { words, banks } = soundsInCode(code);
  const prefixes = new Set([...banks].map((b) => aliases.get(b) ?? b));
  const out = new Set<string>();
  for (const w of words) {
    if (available.has(w)) out.add(w);
    for (const b of prefixes) if (available.has(`${b}_${w}`)) out.add(`${b}_${w}`);
  }
  return out;
}

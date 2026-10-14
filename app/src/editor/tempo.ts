// Tempo as written in the code: the last setcpm(...) / setcps(...) call with a plain number (or a
// number/number such as setcpm(120/4)). Nudging edits that call, or adds one at the top: the code
// stays the only place the tempo lives.

export interface Tempo {
  /** Cycles per second / per minute. */
  cps: number;
  cpm: number;
  fn: 'cpm' | 'cps';
  /** The written argument: num, or num/den. */
  num: number;
  den?: number;
  /** Document range of the argument inside the parentheses. */
  from: number;
  to: number;
  /** Document range of the whole call. */
  call: { from: number; to: number };
}

const CALL = /\b(setcpm|setCpm|setcps|setCps)\(\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*)?\)/g;

/** Strudel's default tempo: 0.5 cycles per second (30 cpm, i.e. 120 bpm at 4 beats per cycle). */
export const DEFAULT_CPS = 0.5;
export const BEATS_PER_CYCLE = 4;

const inComment = (code: string, at: number) => {
  const lineStart = code.lastIndexOf('\n', at - 1) + 1;
  if (code.slice(lineStart, at).includes('//')) return true;
  const open = code.lastIndexOf('/*', at);
  return open !== -1 && code.indexOf('*/', open) > at;
};

export function readTempo(code: string): Tempo | null {
  let found: Tempo | null = null;
  for (const m of code.matchAll(CALL)) {
    if (inComment(code, m.index)) continue;
    const num = Number(m[2]);
    const den = m[3] !== undefined ? Number(m[3]) : undefined;
    if (den === 0) continue;
    const value = den ? num / den : num;
    const fn = m[1].toLowerCase() === 'setcpm' ? 'cpm' : 'cps';
    const argFrom = m.index + m[0].indexOf('(') + 1;
    const argTo = m.index + m[0].length - 1;
    // trim the whitespace inside the parentheses so the edit keeps the author's spacing
    const raw = code.slice(argFrom, argTo);
    const from = argFrom + (raw.length - raw.trimStart().length);
    const to = argTo - (raw.length - raw.trimEnd().length);
    found = { fn, num, ...(den !== undefined ? { den } : {}), cps: fn === 'cpm' ? value / 60 : value, cpm: fn === 'cpm' ? value : value * 60, from, to, call: { from: m.index, to: m.index + m[0].length } };
  }
  return found;
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));
const fmt = (x: number) => String(round(x, 3));

/**
 * The edit that changes the tempo by `steps`: one step is 1 on the written number of setcpm (so
 * setcpm(120/4) moves by 1 bpm), 0.01 on setcps. Without a tempo call, adds `setcpm(...)` on line 1
 * starting from `currentCps` (what the runtime plays).
 */
export function nudgeTempo(code: string, steps: number, currentCps: number = DEFAULT_CPS): { from: number; to: number; insert: string } {
  const t = readTempo(code);
  if (!t) {
    const cpm = Math.max(1, round(currentCps * 60, 2) + steps);
    return { from: 0, to: 0, insert: `setcpm(${fmt(cpm)})\n` };
  }
  const step = t.fn === 'cpm' ? 1 : 0.01;
  const min = t.fn === 'cpm' ? 1 : 0.01;
  const num = Math.max(min, round(t.num + steps * step, 3));
  return { from: t.from, to: t.to, insert: t.den !== undefined ? `${fmt(num)}/${fmt(t.den)}` : fmt(num) };
}

/** e.g. "30 cpm" and "120 bpm" (at 4 beats per cycle). */
export function describeTempo(cps: number) {
  const cpm = cps * 60;
  return { cpm: fmt(round(cpm, 1)), bpm: fmt(round(cpm * BEATS_PER_CYCLE, 1)) };
}

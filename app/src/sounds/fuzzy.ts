// Small fuzzy matcher for the sound browser: prefix > word-boundary substring > substring > subsequence.

/** Score of `query` against `text` (higher is better), or null when it does not match at all. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at === 0) return 1000 - t.length;
  if (at > 0) return (/[^a-z0-9]/.test(t[at - 1]) || /[a-z][A-Z]/.test(text.slice(at - 1, at + 1)) ? 800 : 600) - at - t.length;
  // subsequence: every query character in order; reward runs and word starts, punish gaps
  let score = 300;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const gap = found - ti;
    run = gap === 0 && ti > 0 ? run + 1 : 0;
    score += run * 8 - gap * 3 + (found === 0 || /[^a-z0-9]/.test(t[found - 1]) ? 10 : 0);
    ti = found + 1;
  }
  return Math.max(1, score - t.length);
}

/** Every whitespace-separated term must match one of the fields; the score sums each term's best field. */
export function matchFields(query: string, fields: readonly (string | undefined)[]): number | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let total = 0;
  for (const term of terms) {
    let best: number | null = null;
    for (const f of fields) {
      if (!f) continue;
      const s = fuzzyScore(term, f);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

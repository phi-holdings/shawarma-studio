import { safeHighlightColor } from '../runtime/protocol';

/**
 * Highlight-compatible stand-in for a Strudel hap (only what @strudel/codemirror's highlighter reads).
 * The highlighter writes `value.markcss` / `value.color` into style attributes of this page, so only a
 * validated colour is passed on (song code controls hap values) and `markcss` never is.
 */
export const fakeHap = (begin: number, locs: [number, number][], value: Record<string, unknown>) => {
  const color = safeHighlightColor(value.color);
  return {
    whole: { begin: { valueOf: () => begin, lt: (o: { valueOf(): number }) => begin < o.valueOf() } },
    context: { locations: locs.map(([start, end]) => ({ start, end })) },
    value: color ? { color } : {},
  };
};

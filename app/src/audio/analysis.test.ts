import { expect, test } from 'vitest';
import { analyseChannels } from './analysis';

test('per-section peak and clipping', () => {
  const sr = 10;
  const ch = new Float32Array(40);
  ch[5] = 0.5;            // section A (0-2 s)
  ch[25] = 1.0;           // section B (2-4 s), clipped
  const r = analyseChannels([ch, ch], sr, 0, [
    { label: 'A', startSec: 0, endSec: 2 },
    { label: 'B', startSec: 2, endSec: 4 },
  ]);
  expect(r.sections[0].peakDb).toBeCloseTo(-6.02, 1);
  expect(r.sections[1].clipped).toBe(2);
  expect(r.clipped).toBe(2);
});

test('chunk-by-chunk analysis equals one-shot analysis', async () => {
  const { SectionAnalyser } = await import('./analysis');
  const sr = 10;
  const l = new Float32Array(57), r = new Float32Array(57);
  for (let i = 0; i < l.length; i++) { l[i] = Math.sin(i) * (i / 57); r[i] = Math.cos(i * 1.3) * 0.5; }
  l[33] = 1;
  const sections = [{ label: 'A', startSec: 0, endSec: 2.2 }, { label: 'B', startSec: 2.2, endSec: 5.7 }, { label: 'C', startSec: 9, endSec: 12 }];
  const whole = analyseChannels([l, r], sr, 0, sections);
  const a = new SectionAnalyser(sr, 0, sections);
  for (const [from, to] of [[0, 7], [7, 30], [30, 31], [31, 57]]) a.push([l.subarray(from, to), r.subarray(from, to)]);
  expect(a.report()).toEqual(whole);
});

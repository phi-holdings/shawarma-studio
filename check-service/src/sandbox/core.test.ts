import { expect, test } from 'vitest';
import { evaluateHeadless } from './core.mjs';

test('evaluates strudel code in node and captures tempo + arrange', async () => {
  const r = await evaluateHeadless('setcpm(30)\narrange([2, s("bd sd")], [1, note("c e g").s("sine")])');
  expect(r.cps).toBe(0.5);
  expect(r.arrangeWeights).toEqual([2, 1]);
  const haps = r.pattern.queryArc(0, 3).filter((h: any) => h.hasOnset());
  expect(haps.length).toBe(2 * 2 + 3);
});

test('slider() works headless and returns its default value', async () => {
  const r = await evaluateHeadless('const L = slider(0.5, 0, 1)\ns("bd").gain(L)');
  expect(r.pattern.queryArc(0, 1)[0].value.gain).toBe(0.5);
});

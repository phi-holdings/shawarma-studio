import { expect, test } from 'vitest';
import { fromProgram, soloProgram } from '@shawarma/shared';
import { buildPosMap, mapRange } from './remap';

const doc = 'setcpm(30)\narrange([2, s("bd sd")], [2, s("hh*8")])';

test('identity for the plain document', () => {
  const m = buildPosMap(doc, doc);
  expect(m(5)).toBe(5);
  expect(m(doc.length + 1)).toBeNull();
});

test('run selection: locations in the appended copy map back to the selected source', () => {
  const sel = { from: doc.indexOf('s("hh*8")'), to: doc.indexOf('s("hh*8")') + 's("hh*8")'.length };
  const prog = soloProgram(doc, sel);
  const m = buildPosMap(prog, doc, sel);
  const inCopy = prog.lastIndexOf('hh*8');
  expect(m(inCopy)).toBe(doc.indexOf('hh*8'));
  expect(mapRange(m, inCopy, inCopy + 2)).toEqual([doc.indexOf('hh*8'), doc.indexOf('hh*8') + 2]);
  expect(m(doc.length + 1)).toBeNull();   // the ";(" glue maps nowhere
});

test('play-from programs map without an explicit origin (heuristic copy search)', () => {
  const prog = fromProgram(doc, 2);
  const m = buildPosMap(prog, doc);
  const inCopy = prog.lastIndexOf('"bd sd"');
  expect(m(inCopy)).toBe(doc.indexOf('"bd sd"'));
  expect(buildPosMap('other', doc)(1)).toBeNull();
});

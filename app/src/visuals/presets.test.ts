import { expect, test } from 'vitest';
import { activeVisuals, targetLayer, toggleVisual, type VisualFn } from './presets';

const at = (code: string, needle: string, len = 0) => { const i = code.indexOf(needle); return { from: i, to: i + len }; };
const toggle = (code: string, sel: { from: number; to: number }, fn: VisualFn) => {
  const e = toggleVisual(code, sel, fn)!;
  return code.slice(0, e.from) + e.insert + code.slice(e.to);
};

test('no selection in a pattern: the last expression gets the visual', () => {
  const code = 'setcpm(30)\nnote("c e g").s("piano")\n';
  expect(toggle(code, { from: 0, to: 0 }, '_pianoroll')).toBe('setcpm(30)\nnote("c e g").s("piano")._pianoroll()\n');
  expect(toggle(code, { from: code.length, to: code.length }, '_scope')).toBe('setcpm(30)\nnote("c e g").s("piano")._scope()\n');
});

test('the cursor inside a layer of stack() targets that layer\'s whole chain', () => {
  const code = 'stack(\n  s("bd sd").gain(0.8),\n  note("c e").s("saw")\n)';
  const out = toggle(code, at(code, 'bd'), '_punchcard');
  expect(out).toBe('stack(\n  s("bd sd").gain(0.8)._punchcard(),\n  note("c e").s("saw")\n)');
  const layer = 'note("c e").s("saw")';
  expect(targetLayer(code, at(code, 'saw'))).toEqual(at(code, layer, layer.length));
});

test('a selected $: layer, toggled twice, is back to the original', () => {
  const code = '$: s("hh*8").gain(0.4)\n$: note("c2").s("sawtooth")';
  const sel = at(code, 'hh*8', 4);
  const once = toggle(code, sel, '_scope');
  expect(once).toBe('$: s("hh*8").gain(0.4)._scope()\n$: note("c2").s("sawtooth")');
  expect(activeVisuals(once, sel)).toEqual(new Set(['_scope']));
  expect(toggleVisual(once, sel, '_scope')!.added).toBe(false);
  expect(toggle(once, sel, '_scope')).toBe(code);
});

test('removes a visual in the middle of a chain, options and line break included', () => {
  const code = 'note("c e g")\n  ._pianoroll({ fold: 1 })\n  .s("piano")';
  expect(toggle(code, { from: 0, to: 0 }, '_pianoroll')).toBe('note("c e g")\n  .s("piano")');
});

test('a tempo call is not a pattern: the last expression is used instead', () => {
  const code = 'setcpm(30)\ns("bd")';
  expect(toggle(code, at(code, '30'), '_spectrum')).toBe('setcpm(30)\ns("bd")._spectrum()');
});

test('unparseable code: no edit', () => {
  expect(toggleVisual('s("bd"', { from: 0, to: 0 }, '_scope')).toBeNull();
});

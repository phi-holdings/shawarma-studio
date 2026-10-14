import { expect, test } from 'vitest';
import { LIMITS, parseEvaluated, parseReply, parseRuntimeMessage, safeHighlightColor } from './protocol';
import { fakeHap } from '../editor/highlight';

const ctx = { codeLength: 20 };
const hap = (o: object = {}) => ({ begin: 0, end: 0.5, locs: [[2, 5]], value: { s: 'bd', gain: 0.5, on: true }, ...o });
const haps = (...hs: unknown[]) => parseRuntimeMessage({ type: 'activeHaps', time: 1, haps: hs }, ctx);

test('active haps: valid ones pass as fresh copies', () => {
  const src = hap();
  const m = haps(src);
  expect(m).toEqual({ type: 'activeHaps', time: 1, haps: [{ begin: 0, end: 0.5, locs: [[2, 5]], value: { s: 'bd', gain: 0.5, on: true } }] });
  expect((m as any).haps[0]).not.toBe(src);
  expect(haps(hap({ locs: [] }))).not.toBeNull();
  expect(haps(hap({ locs: [[0, 20]] }))).not.toBeNull();       // up to the code length
});

test('active haps: any malformed field drops the message', () => {
  const bad: [string, unknown][] = [
    ['loc past the code', hap({ locs: [[2, 21]] })],
    ['negative loc', hap({ locs: [[-1, 3]] })],
    ['fractional loc', hap({ locs: [[1.5, 3]] })],
    ['reversed loc', hap({ locs: [[5, 2]] })],
    ['NaN loc', hap({ locs: [[NaN, 2]] })],
    ['loc triple', hap({ locs: [[1, 2, 3]] })],
    ['locs not an array', hap({ locs: 'x' })],
    ['too many locs', hap({ locs: Array.from({ length: LIMITS.hapLocs + 1 }, () => [1, 2]) })],
    ['infinite begin', hap({ begin: Infinity })],
    ['end before begin', hap({ begin: 2, end: 1 })],
    ['object value field', hap({ value: { s: { toString: 1 } } })],
    ['array value', hap({ value: [1] })],
    ['NaN value field', hap({ value: { gain: NaN } })],
    ['huge string', hap({ value: { s: 'x'.repeat(LIMITS.stringLength + 1) } })],
    ['__proto__ key', hap({ value: JSON.parse('{"__proto__": "x"}') })],
    ['too many keys', hap({ value: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 1])) })],
    ['not an object', 5],
  ];
  for (const [what, h] of bad) expect(haps(h), what).toBeNull();
  expect(parseRuntimeMessage({ type: 'activeHaps', time: 1, haps: Array.from({ length: LIMITS.haps + 1 }, () => hap()) }, ctx)).toBeNull();
  expect(parseRuntimeMessage({ type: 'activeHaps', time: NaN, haps: [] }, ctx)).toBeNull();
  // nothing evaluated yet: no position is inside the code
  expect(parseRuntimeMessage({ type: 'activeHaps', time: 1, haps: [hap()] })).toBeNull();
});

test('other runtime messages are checked field by field', () => {
  expect(parseRuntimeMessage({ type: 'slider', id: 'slider_12', value: 0.5 })).toEqual({ type: 'slider', id: 'slider_12', value: 0.5 });
  for (const m of [{ id: 'x', value: 1 }, { id: 'slider_1', value: Infinity }, { id: 'slider_1' }]) expect(parseRuntimeMessage({ type: 'slider', ...m }), JSON.stringify(m)).toBeNull();
  expect(parseRuntimeMessage({ type: 'levels', peak: [0.1, 0.2], rms: [0.05, 0.1] })).toEqual({ type: 'levels', peak: [0.1, 0.2], rms: [0.05, 0.1] });
  expect(parseRuntimeMessage({ type: 'levels', peak: [-1], rms: [0] })).toBeNull();
  expect(parseRuntimeMessage({ type: 'levels', peak: [1, 1, 1], rms: [0, 0, 0] })).toBeNull();
  expect(parseRuntimeMessage({ type: 'levels', peak: [], rms: [] })).toBeNull();
  expect(parseRuntimeMessage({ type: 'error', error: { message: 'x', line: 2, col: 3 } })).toEqual({ type: 'error', error: { message: 'x', line: 2, col: 3 } });
  // a bogus location is dropped, the message kept
  expect(parseRuntimeMessage({ type: 'error', error: { message: 'x', line: -2, col: 1 } })).toEqual({ type: 'error', error: { message: 'x' } });
  expect(parseRuntimeMessage({ type: 'error', error: { message: 'x', line: 1.5 } })).toEqual({ type: 'error', error: { message: 'x' } });
  expect(parseRuntimeMessage({ type: 'error', error: { message: 'x', line: 3, col: '4' } })).toEqual({ type: 'error', error: { message: 'x', line: 3 } });
  expect(parseRuntimeMessage({ type: 'error', error: { message: 5 } })).toBeNull();
  expect((parseRuntimeMessage({ type: 'error', error: { message: 'y'.repeat(10_000) } }) as any).error.message).toHaveLength(LIMITS.messageLength);
  expect(parseRuntimeMessage({ type: 'reply', id: 3, ok: false, error: { message: 'boom' } })).toEqual({ type: 'reply', id: 3, ok: false, error: { message: 'boom' } });
  expect(parseRuntimeMessage({ type: 'reply', id: 0, ok: true, result: null })).toBeNull();
  expect(parseRuntimeMessage({ type: 'reply', id: 1.5, ok: true, result: null })).toBeNull();
  const chs = [new Float32Array(4), new Float32Array(4)];
  expect(parseRuntimeMessage({ type: 'renderChunk', id: 1, index: 0, startSample: 0, channels: chs })).not.toBeNull();
  expect(parseRuntimeMessage({ type: 'renderChunk', id: 1, index: 0, startSample: 0, channels: [new Float32Array(4), new Float32Array(3)] })).toBeNull();
  expect(parseRuntimeMessage({ type: 'renderChunk', id: 1, index: -1, startSample: 0, channels: chs })).toBeNull();
  expect(parseRuntimeMessage({ type: 'renderChunk', id: 1, index: 0, startSample: 0, channels: [...chs, new Float32Array(4)] })).toBeNull();
  expect(parseRuntimeMessage({ type: 'visuals', height: -1 })).toBeNull();
  expect(parseRuntimeMessage({ type: 'whatever' })).toBeNull();
});

test('Evaluated replies: code positions, sliders and cps are validated', () => {
  const ok = { code: 's("bd").gain(slider(0.5,0,1))', miniLocations: [[3, 5]], sliders: [{ from: 20, to: 23, value: '0.5', min: 0, max: 1, step: 0.1 }], cps: 0.5 };
  expect(parseEvaluated(ok)).toEqual(ok);
  expect(parseReply('play', ok)).toEqual({ value: ok });
  const bad: [string, object][] = [
    ['mini location past the code', { miniLocations: [[3, 999]] }],
    ['negative mini location', { miniLocations: [[-1, 2]] }],
    ['slider past the code', { sliders: [{ ...ok.sliders[0], to: 999 }] }],
    ['slider with object value', { sliders: [{ ...ok.sliders[0], value: {} }] }],
    ['slider with NaN min', { sliders: [{ ...ok.sliders[0], min: NaN }] }],
    ['slider with string step', { sliders: [{ ...ok.sliders[0], step: '1' }] }],
    ['zero cps', { cps: 0 }],
    ['NaN cps', { cps: NaN }],
    ['code not a string', { code: 5 }],
  ];
  for (const [what, patch] of bad) {
    expect(parseEvaluated({ ...ok, ...patch }), what).toBeNull();
    expect(parseReply('loop', { ...ok, ...patch }), what).toBeNull();
  }
  expect(parseReply('check', { cps: 0.5 })).toEqual({ value: { cps: 0.5 } });
  expect(parseReply('check', { cps: -1 })).toBeNull();
  const kinds = { normal: 1, long: 0, single: 0 };
  expect(parseReply('renderRange', { sampleRate: 48000, length: 10, chunks: 1, kinds, missing: ['x'] })).toEqual({ value: { sampleRate: 48000, length: 10, chunks: 1, kinds, missing: ['x'] } });
  expect(parseReply('renderRange', { sampleRate: 48000, length: 10, chunks: 1, kinds, missing: [5] })).toBeNull();
  expect(parseReply('renderRange', { sampleRate: 48000, length: 10, chunks: 2, kinds, missing: [] })).toBeNull();
  expect(parseReply('stop', null)).toEqual({ value: null });
  expect(parseReply('stop', { evil: true })).toBeNull();
});

test('highlight colours: only plain colour values; markcss never reaches the editor', () => {
  for (const c of ['#f00', '#ff000080', 'red', 'cornflowerblue', 'rgb(1, 2, 3)', 'rgba(10%, 20%, 30%, 0.5)']) expect(safeHighlightColor(c), c).toBe(c);
  for (const c of ['red; background: url(https://evil.example/x)', 'red}', 'var(--x)', 'url(x)', 'expression(alert(1))', '#ff00zz', 'rgb(1,2,3);x:y', '', 5, null, 'a'.repeat(21)]) {
    expect(safeHighlightColor(c), String(c)).toBeUndefined();
  }
  const h = fakeHap(1, [[0, 2]], { s: 'bd', color: 'red', markcss: 'background:url(https://evil.example/)' });
  expect(h.value).toEqual({ color: 'red' });
  expect(fakeHap(1, [[0, 2]], { color: 'red;position:fixed' }).value).toEqual({});
  expect(h.context.locations).toEqual([{ start: 0, end: 2 }]);
  expect(h.whole.begin.lt({ valueOf: () => 2 })).toBe(true);
});

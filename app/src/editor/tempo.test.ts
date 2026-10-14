import { expect, test } from 'vitest';
import { describeTempo, nudgeTempo, readTempo } from './tempo';

const apply = (code: string, e: { from: number; to: number; insert: string }) => code.slice(0, e.from) + e.insert + code.slice(e.to);

test('reads setcpm, setcpm(bpm/4) and setcps; the last uncommented call wins', () => {
  expect(readTempo('setcpm(30)\ns("bd")')).toMatchObject({ fn: 'cpm', cpm: 30, cps: 0.5, num: 30 });
  expect(readTempo('setcpm(140/4)')).toMatchObject({ fn: 'cpm', cpm: 35, num: 140, den: 4 });
  expect(readTempo('setcps(0.75)')).toMatchObject({ fn: 'cps', cps: 0.75, cpm: 45 });
  expect(readTempo('setcpm(30)\n// setcpm(99)\n/* setcps(9) */')!.cpm).toBe(30);
  expect(readTempo('setcpm(30)\nsetcpm(40)')!.cpm).toBe(40);
  expect(readTempo('s("bd")')).toBeNull();
  expect(readTempo('setcpm(tempo)')).toBeNull();
});

test('nudging edits the number in place and keeps the author\'s form', () => {
  const code = 'setcpm( 30 )\ns("bd")';
  expect(apply(code, nudgeTempo(code, 1))).toBe('setcpm( 31 )\ns("bd")');
  expect(apply('setcpm(120/4)', nudgeTempo('setcpm(120/4)', -1))).toBe('setcpm(119/4)');
  expect(apply('setcps(0.5)', nudgeTempo('setcps(0.5)', 1))).toBe('setcps(0.51)');
  expect(apply('setcpm(1)', nudgeTempo('setcpm(1)', -5))).toBe('setcpm(1)');
});

test('without a tempo call, a setcpm line is added from the playing tempo', () => {
  expect(apply('s("bd")', nudgeTempo('s("bd")', 1))).toBe('setcpm(31)\ns("bd")');
  expect(apply('s("bd")', nudgeTempo('s("bd")', -1, 0.75))).toBe('setcpm(44)\ns("bd")');
});

test('describes cpm and bpm', () => {
  expect(describeTempo(0.5)).toEqual({ cpm: '30', bpm: '120' });
  expect(describeTempo(35 / 60)).toEqual({ cpm: '35', bpm: '140' });
});

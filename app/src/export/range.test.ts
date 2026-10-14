import { expect, test } from 'vitest';
import type { SongMap } from '@shawarma/shared';
import { ExportRangeError, FALLBACK_CYCLES, rangeExportName, rangeSeconds, resolveRange } from './range';

const map: SongMap = {
  cps: 0.5, totalCycles: 24, durationSec: 48,
  sections: [
    { index: 0, label: 'intro', startCycle: 0, cycles: 4, startSec: 0, endSec: 8 },
    { index: 1, label: 'I.   Choir à cappella', startCycle: 4, cycles: 16, startSec: 8, endSec: 40 },
    { index: 2, label: '', startCycle: 20, cycles: 4, startSec: 40, endSec: 48 },
  ],
};

test('whole song: 0 to the arrangement length, or the fallback loop without one', () => {
  expect(resolveRange({ kind: 'all' }, map)).toEqual({ from: 0, to: 24, label: 'whole song', suffix: null });
  expect(resolveRange({ kind: 'all' }, null)).toMatchObject({ from: 0, to: FALLBACK_CYCLES });
});

test('a section spans its start cycle plus its length', () => {
  expect(resolveRange({ kind: 'section', index: 1 }, map)).toEqual({ from: 4, to: 20, label: 'I.   Choir à cappella', suffix: 'section-2-i-choir-a-cappella' });
  expect(resolveRange({ kind: 'section', index: 2 }, map)).toMatchObject({ from: 20, to: 24, label: 'section 3', suffix: 'section-3-section-3' });
  expect(() => resolveRange({ kind: 'section', index: 9 }, map)).toThrow(/no longer in the song/);
  expect(() => resolveRange({ kind: 'section', index: 0 }, null)).toThrow(/no sections/);
});

test('custom cycles are checked', () => {
  expect(resolveRange({ kind: 'cycles', from: 2, to: 6.5 }, map)).toEqual({ from: 2, to: 6.5, label: 'cycles 2–6.5', suffix: 'cycles-2-6_5' });
  expect(resolveRange({ kind: 'cycles', from: 0, to: 100 }, null)).toMatchObject({ from: 0, to: 100 });   // length unknown: allowed
  expect(() => resolveRange({ kind: 'cycles', from: 4, to: 4 }, map)).toThrow(/after the start/);
  expect(() => resolveRange({ kind: 'cycles', from: 5, to: 2 }, map)).toThrow(ExportRangeError);
  expect(() => resolveRange({ kind: 'cycles', from: -1, to: 2 }, map)).toThrow(/negative/);
  expect(() => resolveRange({ kind: 'cycles', from: 0, to: 25 }, map)).toThrow(/24 cycles long/);
  expect(() => resolveRange({ kind: 'cycles', from: NaN, to: 2 }, map)).toThrow(/numbers/);
  expect(() => resolveRange({ kind: 'cycles', from: 0, to: 5000 }, null)).toThrow(/at most/);
});

test('duration and file names', () => {
  expect(rangeSeconds({ from: 4, to: 20 }, 0.5)).toBe(32);
  expect(rangeExportName('night-drive', resolveRange({ kind: 'all' }, map))).toBeUndefined();
  expect(rangeExportName('night-drive', resolveRange({ kind: 'section', index: 0 }, map))).toBe('night-drive-section-1-intro');
  expect(rangeExportName('My Song', resolveRange({ kind: 'cycles', from: 0, to: 8 }, map))).toBe('my-song-cycles-0-8');
  const name = rangeExportName('x'.repeat(100), resolveRange({ kind: 'section', index: 1 }, map))!;
  expect(name.length).toBeLessThanOrEqual(100);
  expect(name).toMatch(/^(?!.*\.\.)(?!.*\.$)[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,99}$/u);   // the server's EXPORT_NAME
});

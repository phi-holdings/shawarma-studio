import { expect, test } from 'vitest';
import { buildSongMap } from './songmap';

test('builds cumulative sections in seconds', () => {
  const m = buildSongMap([8, 8, 16], ['a', 'b', 'c'], 0.5)!;
  expect(m.totalCycles).toBe(32);
  expect(m.durationSec).toBe(64);
  expect(m.sections[2]).toMatchObject({ label: 'c', startCycle: 16, startSec: 32, endSec: 64 });
});

test('falls back to numbered labels when counts differ', () => {
  expect(buildSongMap([2, 2], null, 1)!.sections.map((s) => s.label)).toEqual(['Section 1', 'Section 2']);
});

test('returns null without arrange weights', () => {
  expect(buildSongMap(null, null, 0.5)).toBeNull();
});

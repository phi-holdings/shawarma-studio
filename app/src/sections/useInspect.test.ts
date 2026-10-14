import { expect, test, vi } from 'vitest';
import { debounceLatest, latestGuard } from './useInspect';

test('debounceLatest only runs the last call after the delay', async () => {
  vi.useFakeTimers();
  const fn = vi.fn(async (x: number) => x);
  const d = debounceLatest(fn, 600);
  d(1); d(2); d(3);
  await vi.advanceTimersByTimeAsync(600);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith(3);
  vi.useRealTimers();
});

test('latestGuard only treats the newest token as current', () => {
  const g = latestGuard();
  const a = g.next();
  const b = g.next();
  expect(g.isCurrent(a)).toBe(false);
  expect(g.isCurrent(b)).toBe(true);
});

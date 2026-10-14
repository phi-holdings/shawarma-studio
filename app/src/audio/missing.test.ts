import { expect, test, vi } from 'vitest';
import { missingSoundsMessage, playHaps } from './missing';

const hap = (s: string, begin = 0) => ({ value: { s }, whole: { begin: { valueOf: () => begin } }, duration: 1, ensureObjectValue() {} });

test('collects failing sounds and keeps playing the rest', async () => {
  const play = vi.fn(async (v: any) => { if (v.s === 'nope') throw new Error('sound nope not found'); });
  const missing = await playHaps([hap('bd'), hap('nope'), hap('nope'), hap('sd')], play, 0, 1);
  expect(play).toHaveBeenCalledTimes(4);
  expect(missing).toEqual(['nope']);
  expect(missingSoundsMessage(missing)).toBe('Missing sounds: nope');
});

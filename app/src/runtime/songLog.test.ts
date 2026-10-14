import { expect, test } from 'vitest';
import { SONG_LOG, createLogForwarder, formatArgs, isNoise } from './songLog';
import { parseRuntimeMessage, type RuntimeMessage } from './protocol';

test('formats console arguments and drops %c styling', () => {
  expect(formatArgs(['%c[tonal] not a note "x"', 'background-color: black'])).toBe('[tonal] not a note "x"');
  expect(formatArgs(['n', 3, { a: [1] }, null])).toBe('n 3 {"a":[1]} null');
  expect(formatArgs([new Error('boom')])).toBe('boom');
  expect(formatArgs(['x'.repeat(SONG_LOG.maxLength + 10)])).toHaveLength(SONG_LOG.maxLength + 1);
});

test('Strudel housekeeping is not forwarded', () => {
  expect(isNoise('[eval] code updated')).toBe(true);
  expect(isNoise('[cyclist] start')).toBe(true);
  expect(isNoise('[eval] error: Unexpected token (3:0)')).toBe(true);
  expect(isNoise('[sampler] load sound "bd:0"..')).toBe(true);
  expect(isNoise('[sampler] could not load "bd:9"')).toBe(false);
  expect(isNoise('hello')).toBe(false);
});

test('rate limit: a burst passes, the rest is dropped and reported once', () => {
  let t = 0;
  const out: RuntimeMessage[] = [];
  const later: (() => void)[] = [];
  const fwd = createLogForwarder((m) => out.push(m), () => t, (fn) => later.push(fn));
  for (let i = 0; i < SONG_LOG.burst + 10; i++) fwd('info', `m${i}`);
  expect(out).toHaveLength(SONG_LOG.burst);
  expect(later).toHaveLength(1);
  later[0]();
  expect(out.at(-1)).toEqual({ type: 'log', level: 'warn', message: expect.stringMatching(/^10 more messages were dropped/) });
  t += 1000;   // refilled at perSecond
  for (let i = 0; i < SONG_LOG.perSecond; i++) fwd('warn', 'again');
  expect(out).toHaveLength(SONG_LOG.burst + 1 + SONG_LOG.perSecond);
});

test('the parent accepts only well-formed log messages, size-capped', () => {
  expect(parseRuntimeMessage({ type: 'log', level: 'info', message: 'hi' })).toEqual({ type: 'log', level: 'info', message: 'hi' });
  expect(parseRuntimeMessage({ type: 'log', level: 'loud', message: 'hi' })).toBeNull();
  expect(parseRuntimeMessage({ type: 'log', level: 'info', message: 3 })).toBeNull();
  expect((parseRuntimeMessage({ type: 'log', level: 'error', message: 'x'.repeat(10_000) }) as { message: string }).message.length).toBe(2000);
});

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Handshake } from './handshake';

let log: string[];
let n: number;
const mk = () => {
  log = [];
  n = 0;
  return new Handshake({
    navigate: (nonce) => log.push(`navigate ${nonce}`),
    connect: () => log.push('connect'),
    connected: () => log.push('connected'),
    reset: () => log.push('reset'),
    giveUp: (e) => log.push(`giveUp ${e.message}`),
  }, { randomNonce: () => `n${++n}` });
};
/** HELLO + our load event + ACK for nonce `k`. */
const handshake = (h: Handshake, k: string) => { expect(h.hello(k)).toBe(true); h.loaded(); expect(h.ack(k)).toBe(true); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('HELLO with the current nonce (once) + our load event hand over the port; only the ACK echoing the nonce connects', () => {
  const h = mk();
  h.start();
  expect(h.hello('n0')).toBe(false);
  expect(h.hello(undefined)).toBe(false);
  expect(h.hello('n1')).toBe(true);
  expect(h.hello('n1')).toBe(false);                       // once
  expect(log).toEqual(['navigate n1']);                    // no port before our own load event
  h.loaded();
  expect(log).toEqual(['navigate n1', 'connect']);
  expect(h.state).toBe('connecting');                      // the port went out; no requests yet
  expect(h.ack('n0')).toBe(false);
  expect(h.ack('')).toBe(false);
  expect(h.ack('n1')).toBe(true);
  expect(h.state).toBe('connected');
  expect(log).toEqual(['navigate n1', 'connect', 'connected']);
  expect(h.ack('n1')).toBe(false);
});

test('either order of HELLO and our load event', () => {
  const h = mk();
  h.start();
  h.loaded();
  expect(h.hello('n1')).toBe(true);
  expect(log).toEqual(['navigate n1', 'connect']);
  expect(h.ack('n1')).toBe(true);
  vi.advanceTimersByTime(100_000);                         // all timers cancelled once connected
  expect(log).toEqual(['navigate n1', 'connect', 'connected']);
});

test('a foreign document got the port (navigation between HELLO and the load event): no ACK in 2 s, reload', () => {
  // browser behaviour: HELLO from our runtime, then song code / anything navigates the frame before our
  // load event; that navigation's load is the only load event, and its document receives CONNECT
  const h = mk();
  h.start();
  expect(h.hello('n1')).toBe(true);
  h.loaded();                                              // the foreign document's load
  expect(log).toEqual(['navigate n1', 'connect']);
  expect(h.ack('guess')).toBe(false);                      // it cannot know the nonce
  vi.advanceTimersByTime(1999);
  expect(h.state).toBe('connecting');
  vi.advanceTimersByTime(1);
  expect(log).toEqual(['navigate n1', 'connect', 'reset', 'navigate n2']);
  expect(h.attempt).toBe(1);                               // a failed attempt
  expect(h.ack('n1')).toBe(false);                         // the old nonce is dead
  handshake(h, 'n2');
  expect(h.attempt).toBe(0);
  expect(log.at(-1)).toBe('connected');
});

test('repeated hijacks count toward the bounded retries and end in the error', () => {
  const h = mk();
  h.start();
  for (const k of ['n1', 'n2', 'n3', 'n4']) {
    expect(h.hello(k)).toBe(true);
    h.loaded();
    vi.advanceTimersByTime(2000);
  }
  expect(log.filter((l) => l === 'connect')).toHaveLength(4);
  expect(log.at(-1)).toMatch(/^giveUp /);
  expect(h.state).toBe('failed');
});

test('a load event while connecting or connected resets at once', () => {
  const h = mk();
  h.start();
  expect(h.hello('n1')).toBe(true);
  h.loaded();
  h.loaded();                                              // another load before the ACK
  expect(log).toEqual(['navigate n1', 'connect', 'reset', 'navigate n2']);
  handshake(h, 'n2');
  h.loaded();                                              // connected: the document navigated away
  expect(log.slice(-2)).toEqual(['reset', 'navigate n3']);
  expect(h.attempt).toBe(0);                               // a navigation by song code is not a failed attempt
  handshake(h, 'n3');
  vi.advanceTimersByTime(100_000);
  expect(log.filter((l) => l === 'reset')).toHaveLength(2); // nothing resets a quiet, connected runtime
});

test('an unresponsive runtime (a request timed out) is reset and reloaded', () => {
  const h = mk();
  h.start();
  handshake(h, 'n1');
  h.unresponsive();
  expect(log.slice(-2)).toEqual(['reset', 'navigate n2']);
  handshake(h, 'n2');
  expect(h.state).toBe('connected');
});

test('a load not followed by a valid HELLO within 2 s reloads with a new nonce', () => {
  const h = mk();
  h.start();
  h.loaded();
  vi.advanceTimersByTime(1999);
  expect(log).toEqual(['navigate n1']);
  vi.advanceTimersByTime(1);
  expect(log).toEqual(['navigate n1', 'navigate n2']);
  expect(h.hello('n1')).toBe(false);
  handshake(h, 'n2');
});

test('after 3 failed reloads (20 s, then 10/20/30 s backoff) the error surfaces', () => {
  const h = mk();
  h.start();
  vi.advanceTimersByTime(19_999);
  expect(log).toEqual(['navigate n1']);
  vi.advanceTimersByTime(1);
  expect(log.at(-1)).toBe('navigate n2');
  vi.advanceTimersByTime(10_000);
  expect(log.at(-1)).toBe('navigate n3');
  vi.advanceTimersByTime(20_000);
  expect(log.at(-1)).toBe('navigate n4');
  vi.advanceTimersByTime(29_999);
  expect(log.some((l) => l.startsWith('giveUp'))).toBe(false);
  vi.advanceTimersByTime(1);
  expect(log.at(-1)).toMatch(/^giveUp The song runtime did not load/);
  expect(h.hello('n4')).toBe(false);
  vi.advanceTimersByTime(100_000);
  expect(log.filter((l) => l.startsWith('navigate'))).toHaveLength(4);
});

test('a successful handshake in between cancels the retries and resets the backoff', () => {
  const h = mk();
  h.start();
  vi.advanceTimersByTime(20_000);                          // retry 1 (n2)
  handshake(h, 'n2');
  vi.advanceTimersByTime(200_000);
  expect(log).toEqual(['navigate n1', 'navigate n2', 'connect', 'connected']);
  expect(h.attempt).toBe(0);
});

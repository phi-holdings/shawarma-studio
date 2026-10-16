import { expect, test } from 'vitest';
import { formatDay, trialAction, waitForPro, type BillingStatus } from './billingApi';

const status = (plan: 'free' | 'pro', trial = false): BillingStatus => ({
  plan, status: plan === 'pro' ? (trial ? 'trialing' : 'active') : 'none', ok: plan === 'pro', usedPercent: 0, resetsAt: '2026-11-01T00:00:00.000Z',
  trial, trialEndsAt: trial ? '2026-10-23T00:00:00.000Z' : null, trialDays: 7,
  canUpgrade: plan === 'free', cancelAtPeriodEnd: false, periodEnd: null,
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

test('waitForPro resolves once the plan shows Pro, retrying through errors', async () => {
  const c = clock();
  const answers: (BillingStatus | Error)[] = [status('free'), new Error('offline'), status('free'), status('pro')];
  let calls = 0;
  const r = await waitForPro({ ...c, intervalMs: 1000, getStatus: async () => { const a = answers[calls++]; if (a instanceof Error) throw a; return a; } });
  expect(r).toBe('pro');
  expect(calls).toBe(4);
});

test('waitForPro tells a started trial apart from a paid plan', async () => {
  const c = clock();
  const answers = [status('free'), status('pro', true)];
  let calls = 0;
  expect(await waitForPro({ ...c, getStatus: async () => answers[calls++] })).toBe('trial');
  expect(trialAction(7)).toBe('Start 7-day free trial');
});

test('waitForPro gives up after the timeout', async () => {
  const c = clock();
  let calls = 0;
  const r = await waitForPro({ ...c, timeoutMs: 30_000, intervalMs: 1500, getStatus: async () => { calls++; return status('free'); } });
  expect(r).toBe('timeout');
  expect(calls).toBe(21); // at 0, 1.5 s, ... 30 s
});

test('waitForPro stops when aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  expect(await waitForPro({ signal: ac.signal, getStatus: async () => status('free') })).toBe('aborted');
});

test('reset dates read like the server writes them', () => {
  expect(formatDay('2026-11-01T00:00:00.000Z')).toBe('November 1');
});

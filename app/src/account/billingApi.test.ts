import { expect, test } from 'vitest';
import { formatDay, waitForPro, type BillingStatus } from './billingApi';

const status = (plan: 'free' | 'pro'): BillingStatus => ({
  plan, status: plan === 'pro' ? 'active' : 'none', ok: true, usedPercent: 0, resetsAt: '2026-11-01T00:00:00.000Z',
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

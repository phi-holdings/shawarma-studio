import { expect, test } from 'vitest';
import type { BillingStatus } from './billingApi';
import { billingLine } from './billingCopy';

const base: BillingStatus = {
  plan: 'pro', status: 'active', ok: true, usedPercent: 0, resetsAt: '2026-11-01T00:00:00Z', trial: false, trialEndsAt: null,
  trialDays: 7, canUpgrade: false, cancelAtPeriodEnd: false, periodEnd: '2026-10-23T12:00:00Z', interval: 'month', graceEndsAt: null,
  prices: { month: 12, year: 120, currency: 'USD' },
};
const now = Date.parse('2026-10-16T12:00:00Z');

test('a failed payment is an alert banner with Update card, in and after the grace period', () => {
  expect(billingLine({ ...base, status: 'past_due', graceEndsAt: '2026-10-30T12:00:00Z' }, now))
    .toEqual({ text: 'Payment failed. Update your card by October 30 to keep Pro.', banner: true, action: 'Update card', tone: 'alert' });
  expect(billingLine({ ...base, plan: 'free', status: 'past_due', graceEndsAt: '2026-10-01T00:00:00Z' }, now)?.text)
    .toBe('Payment failed, so Pro is paused. Update your card to get it back.');
});

test('trial: the day it ends and what will be charged; a banner only in the last two days', () => {
  const trial = { ...base, status: 'trialing', trial: true, trialEndsAt: '2026-10-23T12:00:00Z' };
  expect(billingLine(trial, now)).toMatchObject({ text: "Trial ends October 23; you'll be charged $12.", banner: false });
  expect(billingLine({ ...trial, interval: 'year' as const }, now)?.text).toBe("Trial ends October 23; you'll be charged $120.");
  expect(billingLine(trial, Date.parse('2026-10-22T00:00:00Z'))?.banner).toBe(true);
  expect(billingLine({ ...trial, cancelAtPeriodEnd: true }, now)?.text).toBe("Trial ends October 23. It's cancelled, so you won't be charged.");
});

test('paid Pro: renews for the price, or ends when cancelled; Free says nothing', () => {
  expect(billingLine(base, now)?.text).toBe('Renews October 23 for $12.');
  expect(billingLine({ ...base, cancelAtPeriodEnd: true }, now)?.text).toBe("Pro ends October 23. It's cancelled, so you won't be charged again.");
  expect(billingLine({ ...base, plan: 'free', status: 'none', periodEnd: null }, now)).toBeNull();
});

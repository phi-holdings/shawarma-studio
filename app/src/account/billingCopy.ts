// What the app says about someone's subscription: the line in the account panel and Settings, and the
// banner over the app for a failed payment or a trial about to be charged. Pure, so tests can read it.
import { formatDay, type BillingStatus } from './billingApi';

export interface BillingLine {
  text: string;
  /** Shown as a banner over the app too (a failed payment; a trial ending within two days). */
  banner: boolean;
  /** The banner's button: open the Polar customer portal. */
  action?: 'Update card' | 'Manage billing';
  tone: 'alert' | 'info';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** What the next charge will be: the yearly price on yearly Pro, else the monthly one. */
export function nextCharge(s: BillingStatus): string | null {
  if (!s.prices) return null;
  return usd(s.interval === 'year' ? s.prices.year : s.prices.month);
}

export function billingLine(s: BillingStatus, now = Date.now()): BillingLine | null {
  if (s.status === 'past_due') {
    return s.plan === 'pro' && s.graceEndsAt
      ? { text: `Payment failed. Update your card by ${formatDay(s.graceEndsAt)} to keep Pro.`, banner: true, action: 'Update card', tone: 'alert' }
      : { text: 'Payment failed, so Pro is paused. Update your card to get it back.', banner: true, action: 'Update card', tone: 'alert' };
  }
  if (s.plan !== 'pro') return null;
  const end = s.trial ? s.trialEndsAt ?? s.periodEnd : s.periodEnd;
  if (!end) return null;
  const day = formatDay(end);
  if (s.trial) {
    if (s.cancelAtPeriodEnd) return { text: `Trial ends ${day}. It's cancelled, so you won't be charged.`, banner: false, tone: 'info' };
    const charge = nextCharge(s);
    const soon = Date.parse(end) - now <= 2 * DAY_MS;
    return { text: `Trial ends ${day}${charge ? `; you'll be charged ${charge}` : '; then Pro is charged'}.`, banner: soon, action: 'Manage billing', tone: 'info' };
  }
  if (s.cancelAtPeriodEnd) return { text: `Pro ends ${day}. It's cancelled, so you won't be charged again.`, banner: false, tone: 'info' };
  const charge = nextCharge(s);
  return { text: `Renews ${day}${charge ? ` for ${charge}` : ''}.`, banner: false, tone: 'info' };
}

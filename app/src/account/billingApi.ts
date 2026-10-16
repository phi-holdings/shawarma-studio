// Billing calls to the server (server/src/billing/routes.ts) and the success-page polling.
import { failure, OfflineError } from '../api';

/** GET /api/billing/status (mirrors BillingStatus in server/src/billing/routes.ts). */
export interface BillingStatus {
  plan: 'free' | 'pro';
  status: string;
  ok: boolean;
  usedPercent: number;
  resetsAt: string;
  /** On Pro's free trial (Polar status trialing): the allowance shown is the trial's. */
  trial: boolean;
  trialEndsAt: string | null;
  /** Length of Pro's trial in days (the server's TRIAL.days). */
  trialDays: number;
  /** Free: the action is "Start N-day free trial" (the Upgrade flow; Polar adds the trial). */
  canUpgrade: boolean;
  /** Why chat is refused when ok is false: pro_required (Free has no AI) or allowance. */
  code?: 'pro_required' | 'allowance' | 'global_cap' | 'trial_cap';
  message?: string;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  /** Monthly or yearly Pro, when known. */
  interval?: 'month' | 'year' | null;
  /**
   * `past_due`: Polar could not take the last payment and Pro is still kept (until paymentGraceEndsAt,
   * 7 days past the period end). Null otherwise, including after the grace period (plan is then Free).
   */
  paymentIssue?: 'past_due' | null;
  /** While past due: when Pro ends unless the payment goes through. */
  paymentGraceEndsAt?: string | null;
  /** Pro's prices in whole US dollars, before VAT (the server's PRICES). */
  prices?: { month: number; year: number; currency: string };
}

/** The label of the action that starts Pro's trial (checkout). */
export const trialAction = (days: number) => `Start ${days}-day free trial`;

export type BillingInterval = 'month' | 'year';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new OfflineError(); }
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}
const post = <T,>(url: string, body?: unknown) =>
  call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const getBillingStatus = () => call<BillingStatus>('/api/billing/status');
/** Creates a Polar checkout; the browser should go to the returned URL. */
export const startCheckout = (interval: BillingInterval) => post<{ url: string }>('/api/billing/checkout', { interval });
/** Creates a Polar customer portal session (Manage billing). */
export const openPortal = () => post<{ url: string }>('/api/billing/portal');

/** "November 1" (UTC, like the server's reset dates). */
export const formatDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

export interface WaitOptions {
  getStatus?: () => Promise<BillingStatus>;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Polls the status until the plan shows Pro (the webhook has landed) or `timeoutMs` passes: 'trial'
 * when it is Pro's free trial. Network blips while polling are retried, not reported.
 */
export async function waitForPro(opts: WaitOptions = {}): Promise<'pro' | 'trial' | 'timeout' | 'aborted'> {
  const getStatus = opts.getStatus ?? getBillingStatus;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.timeoutMs ?? 30_000);
  for (;;) {
    if (opts.signal?.aborted) return 'aborted';
    try {
      const s = await getStatus();
      if (s.plan === 'pro') return s.trial ? 'trial' : 'pro';
    } catch { /* try again */ }
    if (now() >= deadline) return 'timeout';
    await sleep(opts.intervalMs ?? 1500);
  }
}

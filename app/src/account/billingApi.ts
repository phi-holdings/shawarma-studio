// Billing calls to the server (server/src/billing/routes.ts) and the success-page polling.
import { failure, OfflineError } from '../api';

/** GET /api/billing/status (mirrors BillingStatus in server/src/billing/routes.ts). */
export interface BillingStatus {
  plan: 'free' | 'pro';
  status: string;
  ok: boolean;
  usedPercent: number;
  resetsAt: string;
  canUpgrade: boolean;
  message?: string;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
}

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
 * Polls the status until the plan shows Pro (the webhook has landed) or `timeoutMs` passes.
 * Network blips while polling are retried, not reported.
 */
export async function waitForPro(opts: WaitOptions = {}): Promise<'pro' | 'timeout' | 'aborted'> {
  const getStatus = opts.getStatus ?? getBillingStatus;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.timeoutMs ?? 30_000);
  for (;;) {
    if (opts.signal?.aborted) return 'aborted';
    try {
      if ((await getStatus()).plan === 'pro') return 'pro';
    } catch { /* try again */ }
    if (now() >= deadline) return 'timeout';
    await sleep(opts.intervalMs ?? 1500);
  }
}

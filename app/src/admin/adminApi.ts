// The admin API (server/src/operator/routes.ts). The server decides who is an admin on every request;
// this page only shows what it is given.
import { failure, OfflineError } from '../api';

export interface AdminUser {
  id: string; email: string; name: string | null; createdAt: string; lastActiveAt: string | null;
  plan: 'free' | 'pro'; status: string; trialEnd: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean;
  compUntil: string | null; suspendedAt: string | null; suspendedReason: string | null;
  spentPeriodUsd: number; allowanceUsd: number; spentAllTimeUsd: number; storageBytes: number; logHash: string;
}
export interface AuditEntry { id: number; adminEmail: string; action: string; detail: Record<string, unknown>; createdAt: string }
export type AdminUserDetail = AdminUser & { projects: number; audit: AuditEntry[] };
export interface SpendReport {
  totals: { todayUsd: number; last7dUsd: number; last30dUsd: number };
  top: { id: string; email: string; spentUsd: number }[];
  capHits: { kind: string; today: number; last7d: number; last30d: number }[];
}
export interface FunnelReport {
  days: number; since: string; counts: Record<string, number>;
  rates: { label: string; from: string; to: string; rate: number | null }[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new OfflineError(); }
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}
const post = <T,>(url: string, body: unknown = {}) =>
  call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export const searchUsers = (q: string) => call<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.users);
export const getUser = (id: string) => call<AdminUserDetail>(user(id));
/** `until`: YYYY-MM-DD (Pro to the end of that day, UTC), or null to end the comp. */
export const compPro = (id: string, until: string | null) => post<AdminUserDetail>(`${user(id)}/comp`, { until });
export const suspend = (id: string, reason: string) => post<AdminUserDetail>(`${user(id)}/suspend`, reason ? { reason } : {});
export const unsuspend = (id: string) => post<AdminUserDetail>(`${user(id)}/unsuspend`);
export const resetAllowance = (id: string) => post<AdminUserDetail>(`${user(id)}/reset-allowance`);
export const getSpend = () => call<SpendReport>('/api/admin/spend');
export const getFunnel = (days: number) => call<FunnelReport>(`/api/admin/funnel?days=${days}`);

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'UTC' }) : '-');
export const pct = (r: number | null) => (r === null ? '-' : `${(r * 100).toFixed(1)}%`);
/** "Pro (trial)", "Pro (comp)", "Free", with Polar's status when it says more. */
export function planLabel(u: AdminUser, now = new Date()): string {
  if (u.plan === 'free') return 'Free';
  if (u.compUntil && new Date(u.compUntil) > now && u.status !== 'active' && u.status !== 'trialing') return 'Pro (comp)';
  return u.status === 'trialing' ? 'Pro (trial)' : u.status === 'past_due' ? 'Pro (past due)' : 'Pro';
}

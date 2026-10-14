import { useCallback, useEffect, useState } from 'react';
import { formatDay, getBillingStatus, type BillingStatus } from './billingApi';
import './account.css';

/** Loads /api/billing/status; call `refresh` after a chat reply to update the meter. */
export function useBillingStatus(): { status: BillingStatus | null; error: string | null; refresh(): void } {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    getBillingStatus().then((s) => { setStatus(s); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);
  return { status, error, refresh };
}

/**
 * This month's AI use as a share of the plan's allowance ("62% of this month's AI used"), when it
 * resets, and once it is used up, the server's message with an Upgrade button for Free users.
 */
export function AllowanceMeter(props: { status: BillingStatus; onUpgrade?(): void }) {
  const s = props.status;
  const pct = Math.max(0, Math.min(100, Math.round(s.usedPercent)));
  const level = !s.ok ? ' out' : pct >= 80 ? ' high' : '';
  return (
    <div className={`allowance${level}`}>
      <div className="allowance-head">
        <span className="allowance-used">{pct}% of this month's AI used</span>
        <span>{s.plan === 'pro' ? 'Pro' : 'Free'}</span>
      </div>
      <div className="allowance-bar" role="meter" aria-label="This month's AI used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="allowance-fill" style={{ width: `${pct}%` }} />
      </div>
      {s.ok
        ? <span>Resets {formatDay(s.resetsAt)}</span>
        : <span className="allowance-message" role="status">{s.message ?? `You've used this month's AI allowance. It resets on ${formatDay(s.resetsAt)}.`}</span>}
      {s.canUpgrade && props.onUpgrade && (!s.ok || pct >= 80) && (
        <button type="button" className="btn btn-outline" onClick={props.onUpgrade}>Upgrade to Pro</button>
      )}
    </div>
  );
}

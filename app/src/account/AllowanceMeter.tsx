import { useCallback, useEffect, useState } from 'react';
import { formatDay, getBillingStatus, trialAction, type BillingStatus } from './billingApi';
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
 * resets, and once it is used up, the server's message. Free has no AI: it says so, with the action
 * that starts Pro's trial. On the trial the share is of the trial's allowance, until the trial ends.
 */
export function AllowanceMeter(props: { status: BillingStatus; onUpgrade?(): void }) {
  const s = props.status;
  if (s.plan === 'free') {
    return (
      <div className="allowance">
        <div className="allowance-head">
          <span className="allowance-used">No AI on Free</span>
          <span>Free</span>
        </div>
        <span className="allowance-message">Shawarma's AI comes with Pro. Try it free for {s.trialDays} days; you won't be charged until the trial ends.</span>
        {props.onUpgrade && <button type="button" className="btn btn-outline" onClick={props.onUpgrade}>{trialAction(s.trialDays)}</button>}
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round(s.usedPercent)));
  const level = !s.ok ? ' out' : pct >= 80 ? ' high' : '';
  const what = s.trial ? "the trial's AI" : "this month's AI";
  return (
    <div className={`allowance${level}`}>
      <div className="allowance-head">
        <span className="allowance-used">{pct}% of {what} used</span>
        <span>{s.trial ? 'Pro trial' : 'Pro'}</span>
      </div>
      <div className="allowance-bar" role="meter" aria-label={`${what[0].toUpperCase()}${what.slice(1)} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="allowance-fill" style={{ width: `${pct}%` }} />
      </div>
      {s.ok
        ? <span>{s.trial && s.trialEndsAt ? `Trial ends ${formatDay(s.trialEndsAt)}; Pro's full allowance starts then` : `Resets ${formatDay(s.resetsAt)}`}</span>
        : <span className="allowance-message" role="status">{s.message ?? `You've used this month's AI allowance. It resets on ${formatDay(s.resetsAt)}.`}</span>}
    </div>
  );
}

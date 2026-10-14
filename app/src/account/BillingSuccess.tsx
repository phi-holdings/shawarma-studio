import { useEffect, useState } from 'react';
import { waitForPro, type WaitOptions } from './billingApi';
import './account.css';

type Phase = 'waiting' | 'pro' | 'timeout';

/**
 * The page Polar sends people back to (/billing/success?checkout_id=...). Payment is confirmed by
 * Polar's webhook, so this polls the plan for about 30 seconds until it shows Pro.
 */
export function BillingSuccess(props: { onContinue(): void; wait?: WaitOptions }) {
  const [phase, setPhase] = useState<Phase>('waiting');

  useEffect(() => {
    const ac = new AbortController();
    void waitForPro({ timeoutMs: 30_000, ...props.wait, signal: ac.signal }).then((r) => {
      if (r !== 'aborted') setPhase(r);
    });
    return () => ac.abort();
  }, []);

  return (
    <main className="billing-success">
      <div className="billing-success-card" role="status" aria-live="polite">
        {phase === 'waiting' && <>
          <h1>Confirming your payment…</h1>
          <p>This usually takes a few seconds.</p>
        </>}
        {phase === 'pro' && <>
          <h1>You're on Pro.</h1>
          <p>Your new allowance is ready. Thanks for supporting Shawarma.</p>
          <button type="button" className="btn btn-primary" onClick={props.onContinue}>Back to your songs</button>
        </>}
        {phase === 'timeout' && <>
          <h1>Your plan hasn't updated yet</h1>
          <p>The payment service hasn't confirmed your payment so far. Refresh this page in a minute. If Pro still doesn't show, open Manage billing to check the payment.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button>
            <button type="button" className="btn btn-outline" onClick={props.onContinue}>Back to your songs</button>
          </div>
        </>}
      </div>
    </main>
  );
}

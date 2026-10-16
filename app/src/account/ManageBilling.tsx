import { useEffect, useState } from 'react';
import { openPortal } from './billingApi';
import './account.css';

/**
 * /billing/manage, the "Manage billing" link in Shawarma's emails: opens the payment service's customer
 * portal for the signed-in person (signed out, Root signs them in first and comes back here).
 */
export function ManageBilling(props: { onContinue(): void; open?: () => Promise<{ url: string }>; go?: (url: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (props.open ?? openPortal)()
      .then(({ url }) => (props.go ?? ((u) => window.location.assign(u)))(url))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main className="billing-success">
      <div className="billing-success-card" role="status" aria-live="polite">
        {error === null ? <h1>Opening billing…</h1> : <>
          <h1>Billing didn't open</h1>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={props.onContinue}>Back to your songs</button>
        </>}
      </div>
    </main>
  );
}

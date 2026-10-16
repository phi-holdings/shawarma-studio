// One-line notices over the app (hosted mode): a failed payment or a trial about to be charged
// (billingLine), and Terms/Privacy updated since this person last accepted them (dismiss = accepted).
import { useState } from 'react';
import { acknowledgeLegal } from './accountApi';
import type { BillingStatus } from './billingApi';
import { billingLine } from './billingCopy';

export function BillingBanner(props: { billing: BillingStatus | null; onManageBilling(): Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const line = props.billing ? billingLine(props.billing) : null;
  if (!line?.banner) return null;
  return (
    <div className={`app-banner${line.tone === 'alert' ? ' alert' : ''}`} role={line.tone === 'alert' ? 'alert' : 'status'}>
      <span>{error ?? line.text}</span>
      {line.action && <button className="btn btn-outline" onClick={() => void props.onManageBilling().catch((e) => setError((e as Error).message))}>{line.action}</button>}
    </div>
  );
}

const NAMES = { terms: 'Terms', privacy: 'Privacy page' } as const;

export function LegalBanner(props: { changed: ('terms' | 'privacy')[] }) {
  const [shown, setShown] = useState(props.changed.length > 0);
  if (!shown) return null;
  return (
    <div className="app-banner" role="status">
      <span>
        We updated our {props.changed.map((k, i) => (
          <span key={k}>{i > 0 && ' and '}<a href={`/${k}`} target="_blank" rel="noopener">{NAMES[k]}</a></span>
        ))}.
      </span>
      <button className="btn btn-ghost" aria-label="Dismiss" onClick={() => { setShown(false); void acknowledgeLegal().catch(() => {}); }}>Got it</button>
    </div>
  );
}

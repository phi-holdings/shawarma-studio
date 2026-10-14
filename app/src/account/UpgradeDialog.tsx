import { useEffect, useRef, useState } from 'react';
import { startCheckout, type BillingInterval } from './billingApi';
import './account.css';

/**
 * Upgrade to Pro: pick monthly or yearly billing, then go to Polar's checkout. Prices are set in Polar;
 * pass `prices` (e.g. { month: '$12 a month', year: '$120 a year' }) to show them.
 */
export function UpgradeDialog(props: { onClose(): void; prices?: Partial<Record<BillingInterval, string>>; go?(url: string): void }) {
  const [interval, setChoice] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstOption = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstOption.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = props.go ?? ((url: string) => window.location.assign(url));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startCheckout(interval);
      go(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const option = (value: BillingInterval, label: string, hint: string) => (
    <label className="upgrade-option">
      <input ref={value === 'month' ? firstOption : undefined} type="radio" name="upgrade-interval" value={value}
        checked={interval === value} onChange={() => setChoice(value)} />
      <strong>{label}</strong>
      <span>{props.prices?.[value] ?? hint}</span>
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
        <div className="modal-head">
          <h2 id="upgrade-title">Upgrade to Pro</h2>
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={props.onClose}>×</button>
        </div>
        <section className="modal-section">
          <p className="muted">Pro gives you more AI every month, more projects, and Think deeper. You can cancel any time from Manage billing.</p>
        </section>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="modal-section">
          <fieldset className="upgrade-options">
            <legend>Billing</legend>
            {option('month', 'Monthly', 'Billed every month')}
            {option('year', 'Yearly', 'Billed once a year')}
          </fieldset>
          {error && <div role="alert" className="err-text">{error}</div>}
          <div className="upgrade-actions row">
            <button type="button" className="btn btn-outline" onClick={props.onClose}>Not now</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Opening checkout…' : 'Continue to payment'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

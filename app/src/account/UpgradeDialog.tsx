import { useEffect, useRef, useState } from 'react';
import { startCheckout, trialAction, type BillingInterval } from './billingApi';
import './account.css';

/**
 * Start Pro's free trial: pick monthly or yearly billing, then go to Polar's checkout, which takes a card
 * and charges it when the trial ends (Polar adds the trial; someone who had one before pays at once).
 * Prices are set in Polar; pass `prices` (e.g. { month: '$12 a month', year: '$120 a year' }) to show them.
 */
export function UpgradeDialog(props: { onClose(): void; trialDays: number; prices?: Partial<Record<BillingInterval, string>>; go?(url: string): void }) {
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
          <h2 id="upgrade-title">{trialAction(props.trialDays)}</h2>
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={props.onClose}>×</button>
        </div>
        <section className="modal-section">
          <p className="muted">Pro gives you Shawarma's AI every month, up to 200 projects, 2 GB of files, and Think deeper.</p>
          <p className="muted">The first {props.trialDays} days are free. You add a card at checkout and it's charged when the trial ends; cancel before then from Manage billing and you pay nothing. The trial includes a smaller AI allowance, and Think deeper starts when it ends. One trial per person.</p>
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
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Opening checkout…' : 'Continue to checkout'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

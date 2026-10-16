import { useEffect, useRef, useState } from 'react';
import { usd, VAT_NOTE, yearlySaving } from '../landing/proPrices';
import { startCheckout, trialAction, type BillingInterval } from './billingApi';
import './account.css';

/**
 * Start Pro's free trial: pick monthly or yearly billing, then go to Polar's checkout, which takes a card
 * and charges it when the trial ends (Polar adds the trial; someone who had one before pays at once).
 * `prices`: the server's (billing status, from plans.ts PRICES); without them the options say only how often.
 */
export function UpgradeDialog(props: { onClose(): void; trialDays: number; prices?: { month: number; year: number }; go?(url: string): void }) {
  const p = props.prices;
  const saving = p ? yearlySaving(p) : null;
  const priceOf: Partial<Record<BillingInterval, string>> = p
    ? { month: `${usd(p.month)} a month`, year: `${usd(p.year)} a year${saving ? ` (${saving})` : ''}` }
    : {};
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
      <span>{priceOf[value] ?? hint}</span>
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
          {p && <p className="upgrade-then"><strong>{props.trialDays} days free</strong>, then {interval === 'year' ? `${usd(p.year)} a year` : `${usd(p.month)} a month`}.</p>}
          <p className="muted">The first {props.trialDays} days are free. You add a card at checkout and it's charged when the trial ends; cancel before then from Manage billing and you pay nothing. The trial includes a smaller AI allowance, and Think deeper starts when it ends. One trial per person.</p>
          <p className="muted upgrade-fine">{VAT_NOTE} <a href="/pricing" target="_blank" rel="noopener">Pricing</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>
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

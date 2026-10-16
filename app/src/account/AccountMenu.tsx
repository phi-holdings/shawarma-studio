// The account at the bottom of the sidebar (hosted mode): who is signed in and their plan; opens a panel
// with this month's allowance, Upgrade (Free), Manage billing and Sign out, and links to the source
// code (AGPL: everyone using the service must be offered it), privacy and terms.
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../api';
import { AllowanceMeter } from './AllowanceMeter';
import type { BillingStatus } from './billingApi';
import './account.css';

type HostedMe = Extract<Me, { mode: 'hosted' }>;

const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();

export function Avatar(props: { user: HostedMe['user']; size?: number }) {
  const [broken, setBroken] = useState(false);
  const label = props.user.name ?? props.user.email;
  return props.user.avatarUrl && !broken
    ? <img className="avatar" src={props.user.avatarUrl} alt="" width={props.size ?? 24} height={props.size ?? 24} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="avatar avatar-initial" aria-hidden="true">{initial(label)}</span>;
}

export function AccountMenu(props: {
  me: HostedMe;
  billing: BillingStatus | null;
  onUpgrade(): void;
  onManageBilling(): Promise<void>;
  onSignOut(): Promise<void>;
  /** Called when the panel opens (refresh the allowance). */
  onOpen?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'billing' | 'signout'>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const plan = props.billing?.plan ?? props.me.plan;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = async (kind: 'billing' | 'signout', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="account" ref={root}>
      {open && (
        <div className="account-panel" role="dialog" aria-label="Account">
          <div className="account-who">
            <strong>{props.me.user.name ?? props.me.user.email}</strong>
            {props.me.user.name && <span>{props.me.user.email}</span>}
          </div>
          {props.billing && <AllowanceMeter status={props.billing} />}
          {error && <div role="alert" className="err-text">{error}</div>}
          <div className="account-actions">
            {plan === 'free' && <button type="button" className="btn btn-primary" onClick={() => { setOpen(false); props.onUpgrade(); }}>Upgrade to Pro</button>}
            {(plan === 'pro' || (props.billing && props.billing.status !== 'none')) && (
              <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void run('billing', props.onManageBilling)}>
                {busy === 'billing' ? 'Opening billing…' : 'Manage billing'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run('signout', props.onSignOut)}>
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          <nav className="account-links" aria-label="About Shawarma">
            <a href="/source" target="_blank" rel="noopener">Source code</a>
            <a href="/privacy" target="_blank" rel="noopener">Privacy</a>
            <a href="/terms" target="_blank" rel="noopener">Terms</a>
          </nav>
        </div>
      )}
      <button type="button" className="btn btn-ghost account-button" aria-expanded={open} aria-label={`Account: ${props.me.user.name ?? props.me.user.email}, ${plan === 'pro' ? 'Pro' : 'Free'} plan`}
        onClick={() => { const next = !open; setOpen(next); if (next) props.onOpen?.(); }}>
        <Avatar user={props.me.user} />
        <span className="account-name">{props.me.user.name ?? props.me.user.email}</span>
        <span className={`plan-badge${plan === 'pro' ? ' pro' : ''}`}>{plan === 'pro' ? 'Pro' : 'Free'}</span>
      </button>
    </div>
  );
}

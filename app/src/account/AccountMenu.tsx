// The account at the bottom of the sidebar (hosted mode): who is signed in and their plan; opens a panel
// with this month's allowance, the subscription's next step, the free trial (Free), Manage billing, the
// Account page, Sign out and Help & feedback, and links to the source
// code (AGPL: everyone using the service must be offered it), privacy and terms.
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../api';
import { BUILD } from '../build';
import { CONTACT_EMAIL } from '../landing/contact';
import { AllowanceMeter } from './AllowanceMeter';
import { trialAction, type BillingStatus } from './billingApi';
import { billingLine } from './billingCopy';
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

/** mailto: for Help & feedback, with the build and the browser filled in. */
export function helpMailto(): string {
  const body = `\n\n---\nShawarma ${BUILD.id}\n${typeof navigator === 'undefined' ? '' : navigator.userAgent}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Shawarma: help and feedback')}&body=${encodeURIComponent(body)}`;
}

export function AccountMenu(props: {
  me: HostedMe;
  billing: BillingStatus | null;
  onUpgrade(): void;
  onManageBilling(): Promise<void>;
  onSignOut(): Promise<void>;
  /** Opens the Account page (export, sign out everywhere, delete). */
  onAccount(): void;
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
          {props.billing && (() => { const l = billingLine(props.billing); return l && <p className={`account-billing-line${l.tone === 'alert' ? ' alert' : ''}`}>{l.text}</p>; })()}
          {error && <div role="alert" className="err-text">{error}</div>}
          <div className="account-actions">
            {plan === 'free' && <button type="button" className="btn btn-primary" onClick={() => { setOpen(false); props.onUpgrade(); }}>{trialAction(props.billing?.trialDays ?? props.me.billing.trialDays)}</button>}
            {(plan === 'pro' || (props.billing && props.billing.status !== 'none')) && (
              <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void run('billing', props.onManageBilling)}>
                {busy === 'billing' ? 'Opening billing…' : 'Manage billing'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); props.onAccount(); }}>Account…</button>
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run('signout', props.onSignOut)}>
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          <a className="account-help" href={helpMailto()}>Help &amp; feedback</a>
          <nav className="account-links" aria-label="About Shawarma">
            {props.me.admin && <a href="/admin">Admin</a>}
            <a href="/source" target="_blank" rel="noopener">Source code</a>
            <a href="/pricing" target="_blank" rel="noopener">Pricing</a>
            <a href="/privacy" target="_blank" rel="noopener">Privacy</a>
            <a href="/terms" target="_blank" rel="noopener">Terms</a>
          </nav>
        </div>
      )}
      <button type="button" className="btn btn-ghost account-button" aria-expanded={open} aria-label={`Account: ${props.me.user.name ?? props.me.user.email}, ${plan === 'pro' ? 'Pro' : 'Free'} plan`}
        onClick={() => { const next = !open; setOpen(next); if (next) props.onOpen?.(); }}>
        <Avatar user={props.me.user} />
        <span className="account-name">{props.me.user.name ?? props.me.user.email}</span>
        <span className={`plan-badge${plan === 'pro' ? ' pro' : ''}`}>{plan === 'pro' ? (props.billing?.trial ? 'Pro trial' : 'Pro') : 'Free'}</span>
      </button>
    </div>
  );
}

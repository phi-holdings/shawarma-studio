// The Account page (account menu > Account…): download everything, end every session, delete the account.
// Sign-in is Google only; losing access is a support mail (Terms, Privacy).
import { useState } from 'react';
import { Modal } from '../projects/Modal';
import { CONTACT_EMAIL } from '../landing/contact';
import { deleteMyAccount, exportMyData, signOutEverywhere } from './accountApi';
import './account.css';

export function AccountDialog(props: {
  email: string;
  onClose(): void;
  /** After sign out everywhere or deletion: leave the app (default: go to the front page). */
  onSignedOut?(): void;
  /** Opens Manage billing (cancel a subscription before deleting). */
  onManageBilling?(): Promise<void>;
}) {
  const [busy, setBusy] = useState<null | 'export' | 'everywhere' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const out = props.onSignedOut ?? (() => window.location.assign('/'));

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const matches = typed.trim().toLowerCase() === props.email.toLowerCase();

  return (
    <Modal title="Account" onClose={props.onClose} className="account-dialog">
      <section className="modal-section">
        <h3>Signed in with Google</h3>
        <p className="muted">{props.email}. Google is the only way to sign in; if you lose access to this Google account, write to {CONTACT_EMAIL}.</p>
      </section>
      <section className="modal-section">
        <h3>Your data</h3>
        <p className="muted">One JSON file with your account, every project (also those in the trash) with its versions and chat, and a list of your sound and export files. Audio files themselves download from each project's Exports tab.</p>
        <div className="row"><button className="btn btn-outline" disabled={busy !== null} onClick={() => void run('export', async () => { await exportMyData(); setNotice('Your data is downloading.'); })}>
          {busy === 'export' ? 'Preparing…' : 'Export my data'}
        </button></div>
      </section>
      <section className="modal-section">
        <h3>Sessions</h3>
        <p className="muted">Signs you out on every device and browser, this one included.</p>
        <div className="row"><button className="btn btn-outline" disabled={busy !== null} onClick={() => void run('everywhere', async () => { await signOutEverywhere(); out(); })}>
          {busy === 'everywhere' ? 'Signing out…' : 'Sign out everywhere'}
        </button></div>
      </section>
      <section className="modal-section account-danger">
        <h3>Delete account</h3>
        <p className="muted">Deletes your account, projects, chats and files now. It cannot be undone; encrypted backups age out within 12 months. A Pro subscription or trial that would still charge you must be cancelled first, in Manage billing.</p>
        {!confirming
          ? <div className="row"><button className="btn btn-danger" disabled={busy !== null} onClick={() => setConfirming(true)}>Delete my account…</button></div>
          : (
            <form className="account-delete" onSubmit={(e) => { e.preventDefault(); if (matches) void run('delete', async () => { await deleteMyAccount(typed); out(); }); }}>
              <label>Type <strong>{props.email}</strong> to confirm
                <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type your email to confirm" />
              </label>
              <div className="row">
                <button type="button" className="btn btn-ghost" onClick={() => { setConfirming(false); setTyped(''); }}>Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={!matches || busy !== null}>{busy === 'delete' ? 'Deleting…' : 'Delete my account for good'}</button>
              </div>
            </form>
          )}
      </section>
      {notice && <p role="status" className="modal-section muted">{notice}</p>}
      {error && (
        <div role="alert" className="modal-section err-text">
          {error}
          {props.onManageBilling && /Manage billing/.test(error) && <> <button className="btn btn-outline" onClick={() => void props.onManageBilling!().catch((e) => setError((e as Error).message))}>Manage billing</button></>}
        </div>
      )}
    </Modal>
  );
}

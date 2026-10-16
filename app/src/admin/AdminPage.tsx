// /admin (hosted mode): users, spend and the sign-up funnel for the operator. Everything here comes from
// /api/admin/*, which answers only people in SHAWARMA_ADMIN_EMAILS (403 for everyone else).
import { useEffect, useState } from 'react';
import { ServerError } from '../api';
import {
  bytes, compPro, date, getFunnel, getSpend, getUser, pct, planLabel, resetAllowance, searchUsers, suspend, unsuspend, usd,
  type AdminUser, type AdminUserDetail, type FunnelReport, type SpendReport,
} from './adminApi';
import './admin.css';

type Tab = 'users' | 'spend' | 'funnel';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [forbidden, setForbidden] = useState(false);
  const onError = (e: unknown, set: (m: string) => void) => {
    if (e instanceof ServerError && e.status === 403) setForbidden(true);
    else set((e as Error).message);
  };
  if (forbidden) {
    return (
      <main className="admin admin-denied">
        <h1>Not allowed</h1>
        <p>This page is for Shawarma's operators.</p>
        <a className="btn btn-outline" href="/">Back to your songs</a>
      </main>
    );
  }
  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Admin</h1>
        <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
          {(['users', 'spend', 'funnel'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn btn-ghost${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'users' ? 'Users' : t === 'spend' ? 'Spend' : 'Funnel'}
            </button>
          ))}
        </nav>
        <a className="admin-back" href="/">Back to the app</a>
      </header>
      {tab === 'users' && <Users onError={onError} />}
      {tab === 'spend' && <Spend onError={onError} />}
      {tab === 'funnel' && <Funnel onError={onError} />}
    </main>
  );
}

type OnError = (e: unknown, set: (m: string) => void) => void;

function Users(props: { onError: OnError }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (query: string) => {
    setError(null);
    searchUsers(query).then(setUsers, (e) => props.onError(e, setError));
  };
  useEffect(() => { load(''); }, []);
  return (
    <section className="admin-section">
      <form className="admin-search" role="search" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <input type="search" aria-label="Search by email" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-outline">Search</button>
      </form>
      {error && <p role="alert" className="err-text">{error}</p>}
      {users && (
        <table className="admin-table">
          <thead><tr><th>Email</th><th>Plan</th><th>Trial ends</th><th>Created</th><th>Last active</th><th>AI this period</th><th>AI all time</th><th>Storage</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={selected === u.id ? 'selected' : ''}>
                <td><button type="button" className="admin-link" onClick={() => setSelected(u.id)}>{u.email}</button>{u.suspendedAt && <span className="admin-flag">suspended</span>}</td>
                <td>{planLabel(u)}</td>
                <td>{date(u.trialEnd)}</td>
                <td>{date(u.createdAt)}</td>
                <td>{date(u.lastActiveAt)}</td>
                <td>{usd(u.spentPeriodUsd)} / {usd(u.allowanceUsd)}</td>
                <td>{usd(u.spentAllTimeUsd)}</td>
                <td>{bytes(u.storageBytes)}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={8} className="admin-empty">No users match.</td></tr>}
          </tbody>
        </table>
      )}
      {selected && <UserDetail id={selected} onError={props.onError} onChanged={() => load(q)} onClose={() => setSelected(null)} />}
    </section>
  );
}

function UserDetail(props: { id: string; onError: OnError; onChanged(): void; onClose(): void }) {
  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { setU(null); getUser(props.id).then(setU, (e) => props.onError(e, setError)); }, [props.id]);
  const act = async (fn: () => Promise<AdminUserDetail>) => {
    setBusy(true);
    setError(null);
    try { setU(await fn()); props.onChanged(); } catch (e) { props.onError(e, setError); } finally { setBusy(false); }
  };
  if (!u) return error ? <p role="alert" className="err-text">{error}</p> : null;
  return (
    <section className="admin-detail" aria-label={`User ${u.email}`}>
      <div className="admin-detail-head">
        <h2>{u.email}</h2>
        <button type="button" className="btn btn-ghost" onClick={props.onClose}>Close</button>
      </div>
      <dl className="admin-facts">
        <dt>Plan</dt><dd>{planLabel(u)} (Polar: {u.status}{u.cancelAtPeriodEnd ? ', cancels at period end' : ''})</dd>
        <dt>Period ends</dt><dd>{date(u.periodEnd)}</dd>
        <dt>Comp until</dt><dd>{date(u.compUntil)}</dd>
        <dt>AI</dt><dd>{usd(u.spentPeriodUsd)} of {usd(u.allowanceUsd)} this period, {usd(u.spentAllTimeUsd)} all time</dd>
        <dt>Projects</dt><dd>{u.projects}, {bytes(u.storageBytes)} of files</dd>
        <dt>Status</dt><dd>{u.suspendedAt ? `Suspended ${date(u.suspendedAt)}${u.suspendedReason ? `: ${u.suspendedReason}` : ''}` : 'Active'}</dd>
        <dt>Log tag</dt><dd><code>{u.logHash}</code></dd>
      </dl>
      {error && <p role="alert" className="err-text">{error}</p>}
      <div className="admin-actions">
        <form onSubmit={(e) => { e.preventDefault(); if (until) void act(() => compPro(u.id, until)); }}>
          <label>Comp Pro until <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
          <button type="submit" className="btn btn-outline" disabled={busy}>Comp Pro</button>
          {u.compUntil && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => compPro(u.id, null))}>End comp</button>}
        </form>
        {u.suspendedAt
          ? <div><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void act(() => unsuspend(u.id))}>Unsuspend</button></div>
          : (
            <form onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Suspend ${u.email}? They are signed out everywhere and can't sign in.`)) void act(() => suspend(u.id, reason.trim())); }}>
              <label>Reason <input type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" /></label>
              <button type="submit" className="btn btn-outline danger" disabled={busy}>Suspend</button>
            </form>
          )}
        <div>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { if (window.confirm(`Reset ${u.email}'s AI allowance for this period?`)) void act(() => resetAllowance(u.id)); }}>Reset allowance</button>
        </div>
      </div>
      <h3>Audit log</h3>
      {u.audit.length === 0 ? <p className="admin-empty">No admin actions yet.</p> : (
        <ul className="admin-audit">
          {u.audit.map((a) => <li key={a.id}><time>{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</time> {a.action} by {a.adminEmail} {Object.keys(a.detail).length ? <code>{JSON.stringify(a.detail)}</code> : null}</li>)}
        </ul>
      )}
    </section>
  );
}

function Spend(props: { onError: OnError }) {
  const [s, setS] = useState<SpendReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getSpend().then(setS, (e) => props.onError(e, setError)); }, []);
  if (error) return <p role="alert" className="err-text">{error}</p>;
  if (!s) return null;
  return (
    <section className="admin-section">
      <div className="admin-stats">
        <div><span>Today (UTC)</span><strong>{usd(s.totals.todayUsd)}</strong></div>
        <div><span>Last 7 days</span><strong>{usd(s.totals.last7dUsd)}</strong></div>
        <div><span>Last 30 days</span><strong>{usd(s.totals.last30dUsd)}</strong></div>
      </div>
      <h2>Top users, last 30 days</h2>
      <table className="admin-table">
        <thead><tr><th>Email</th><th>AI cost</th></tr></thead>
        <tbody>
          {s.top.map((t) => <tr key={t.id}><td>{t.email}</td><td>{usd(t.spentUsd)}</td></tr>)}
          {s.top.length === 0 && <tr><td colSpan={2} className="admin-empty">No AI use yet.</td></tr>}
        </tbody>
      </table>
      <h2>Cap hits</h2>
      <table className="admin-table">
        <thead><tr><th>Limit</th><th>Today</th><th>7 days</th><th>30 days</th></tr></thead>
        <tbody>
          {s.capHits.map((c) => <tr key={c.kind}><td>{c.kind === 'allowance' ? 'Allowance used up' : c.kind === 'global_cap' ? 'Global daily cap' : 'Trial pool cap'}</td><td>{c.today}</td><td>{c.last7d}</td><td>{c.last30d}</td></tr>)}
          {s.capHits.length === 0 && <tr><td colSpan={4} className="admin-empty">No cap hits.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function Funnel(props: { onError: OnError }) {
  const [days, setDays] = useState(30);
  const [f, setF] = useState<FunnelReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getFunnel(days).then(setF, (e) => props.onError(e, setError)); }, [days]);
  return (
    <section className="admin-section">
      <label className="admin-days">Window
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
      {error && <p role="alert" className="err-text">{error}</p>}
      {f && <>
        <table className="admin-table">
          <thead><tr><th>Step</th><th>People</th></tr></thead>
          <tbody>{Object.entries(f.counts).map(([k, n]) => <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td>{n}</td></tr>)}</tbody>
        </table>
        <h2>Conversion</h2>
        <table className="admin-table">
          <tbody>{f.rates.map((r) => <tr key={r.label}><td>{r.label}</td><td>{pct(r.rate)}</td></tr>)}</tbody>
        </table>
      </>}
    </section>
  );
}

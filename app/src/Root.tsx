// What the page shows before the app: /api/me decides. Local mode (always signed in) and a server that
// is down go straight to the app, as before. Hosted mode while signed out shows the landing page (the
// server sends the prerendered one at `/` in production; in dev Vite serves this shell for every path).
// /pricing, /privacy, /terms and /source render the public pages here in dev; /billing/success is Polar's return page,
// /billing/manage the emails' Manage billing link, /admin the operator's view (hosted, admins only).
import { useEffect, useState } from 'react';
import { getMe, SIGNED_OUT_EVENT, type Me } from './api';
import { App } from './App';
import { setSoundPacks } from './runtime/client';
import { BillingSuccess } from './account/BillingSuccess';
import { ManageBilling } from './account/ManageBilling';
import { AdminPage } from './admin/AdminPage';
import { defaultLinks } from './landing/contact';
import { Landing } from './landing/Landing';
import { Pricing } from './landing/Pricing';
import { Privacy } from './landing/Privacy';
import { Source } from './landing/Source';
import { Terms } from './landing/Terms';
import { signInErrorMessage } from './seo/signInError';

type State = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'app'; me: Me | null };

/** Pages that come back to themselves after "Continue with Google". */
const RETURN_PAGES = new Set(['/billing/success', '/billing/manage', '/admin']);

/** "Continue with Google", coming back to this page (Polar's return page, the billing link, the admin view). */
export function signInHref(pathname: string, search: string): string {
  return RETURN_PAGES.has(pathname) ? `/auth/google?return=${encodeURIComponent(pathname + search)}` : '/auth/google';
}

export function Root() {
  const path = window.location.pathname;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const publicPage = path === '/privacy' || path === '/terms' || path === '/source' || path === '/pricing';

  useEffect(() => {
    if (publicPage) return;
    getMe()
      .then((me) => {
        // hosted Shawarma offers only cleanly licensed sample packs (set before the runtime first loads)
        setSoundPacks(me?.mode === 'hosted' ? 'hosted' : 'all', me?.mode === 'hosted' ? me.packsUrl ?? null : null);
        setState(me ? { kind: 'app', me } : { kind: 'signed-out' });
      })
      // server down or an older server: the app handles being offline itself
      .catch(() => setState({ kind: 'app', me: null }));
    // the session ended while the app was open (expired, signed out in another tab)
    const out = () => setState({ kind: 'signed-out' });
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, out);
  }, []);

  if (path === '/pricing') return <Pricing links={defaultLinks} />;
  if (path === '/privacy') return <Privacy links={defaultLinks} />;
  if (path === '/terms') return <Terms links={defaultLinks} />;
  if (path === '/source') return <Source links={defaultLinks} />;
  if (state.kind === 'loading') return <div className="loading">Loading…</div>;
  if (state.kind === 'signed-out') {
    const error = signInErrorMessage(new URLSearchParams(window.location.search).get('error'));
    return <Landing signInHref={signInHref(path, window.location.search)} {...(error ? { error } : {})} />;
  }
  if (path === '/billing/success') return <BillingSuccess onContinue={() => window.location.assign('/')} />;
  if (path === '/billing/manage') return <ManageBilling onContinue={() => window.location.assign('/')} />;
  if (path === '/admin') return <AdminPage />;
  return <App me={state.me} />;
}

// Error reports from the browser app (hosted builds): only when the build sets VITE_SENTRY_DSN (Sentry
// protocol, so a self-hosted GlitchTip works too); otherwise nothing is loaded. Reports carry no personal
// data: no breadcrumbs (they would hold clicks, console lines and requests), no request data or query
// strings, no user, and email addresses replaced with [email]. Song code and chat text never reach them:
// songs run in the runtime frame, which does not report, and error texts are cut short.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX = 300;
const clean = (s: string) => s.replace(EMAIL, '[email]').slice(0, MAX);

type Event = {
  message?: string;
  exception?: { values?: { value?: string }[] };
  request?: { url?: string; [k: string]: unknown };
  user?: unknown;
  breadcrumbs?: unknown[];
  extra?: unknown;
  [k: string]: unknown;
};

export function scrubBrowserEvent<E extends Event>(e: E): E {
  const out: E = { ...e, breadcrumbs: [] };
  delete out.user;
  delete out.extra;
  if (out.request) out.request = { ...(typeof out.request.url === 'string' ? { url: out.request.url.split(/[?#]/)[0] } : {}) };
  if (out.message) out.message = clean(out.message);
  if (out.exception?.values) out.exception = { ...out.exception, values: out.exception.values.map((v) => (v.value ? { ...v, value: clean(v.value) } : v)) };
  return out;
}

/** Starts error reporting when the build has a DSN. */
export async function initMonitoring(dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN): Promise<boolean> {
  if (!dsn?.trim()) return false;
  const Sentry = await import('@sentry/browser');
  Sentry.init({
    dsn: dsn.trim(),
    environment: import.meta.env.MODE,
    // errors only: the default integrations minus breadcrumbs (no click, console or request trail)
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Breadcrumbs'),
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubBrowserEvent(event as unknown as Event) as unknown as typeof event,
  });
  return true;
}

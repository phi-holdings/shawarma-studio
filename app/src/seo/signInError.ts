// A failed sign-in comes back to the prerendered landing page as /?error=<code>. The page shows a fixed
// sentence for the code (never text from the URL, so a crafted link cannot put words on our page).

import { CONTACT_EMAIL } from '../landing/contact';

const MESSAGES: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled. Continue with Google to try again.',
  expired: 'The sign-in took too long and expired. Continue with Google to try again.',
  unverified_email: 'Google has not verified the email address of that account. Verify it with Google, or use another account.',
  rate_limited: 'Too many sign-in attempts from here. Wait a few minutes, then continue with Google.',
  suspended: `This account is suspended. If you think that is a mistake, write to ${CONTACT_EMAIL}.`,
};
const FALLBACK = 'Sign-in did not finish. Continue with Google to try again.';

export function signInErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK;
}

/** Puts the message where Landing renders its `error` prop: a role=alert paragraph above the sign-in. */
export function showSignInError(doc: Document, search: string): void {
  const message = signInErrorMessage(new URLSearchParams(search).get('error'));
  const cta = doc.querySelector('.ld-cta');
  if (!message || !cta) return;
  const p = doc.createElement('p');
  p.className = 'ld-error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  cta.before(p);
}

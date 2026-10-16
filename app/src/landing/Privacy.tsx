import { LEGAL_VERSIONS } from '@shawarma/shared';
import { DocPage, Mail, type DocPageProps, legalDate } from './DocPage';
import { OPERATOR } from './Terms';

// Every statement here should match what the code and the hosted setup do (server/src/auth/sessions.ts,
// server/migrations, server/src/monitoring.ts + src/monitoring.ts (error reports), src/seo/analytics.ts
// (Umami), server/src/email, deploy/backup.sh, deploy/docker-compose.yml). Bump LEGAL_VERSIONS.privacy
// (@shawarma/shared) whenever this page changes in a way that matters.
//
// Optional services follow the build: the Umami lines appear only when the build has VITE_UMAMI_WEBSITE_ID
// and VITE_UMAMI_SRC (the same rule as the script tag); error reports are named whenever they can be on
// (SENTRY_DSN on the server, VITE_SENTRY_DSN in the build). Backup retention follows
// `restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12` (deploy/backup.sh).
import { umamiTag } from '../seo/analytics';

const EMAIL_PROVIDER = 'Resend';
export const BACKUP_RETENTION = '12 months';
/** Umami's host when this build counts page views, else null. */
const umamiHost = (() => {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  if (!umamiTag(env.VITE_UMAMI_WEBSITE_ID, env.VITE_UMAMI_SRC)) return null;
  try { return new URL(env.VITE_UMAMI_SRC!.trim()).host; } catch { return null; }
})();

export function Privacy({ links }: DocPageProps) {
  return (
    <DocPage title="Privacy" updated={legalDate(LEGAL_VERSIONS.privacy)} links={links}>
      <p>This page says what Shawarma REPL keeps about you, why, who else sees it, and for how long. Shawarma is run by {OPERATOR}; write to <Mail subject="My Shawarma data" /> about anything here.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Your Google account basics:</strong> Google’s id for your account, your email address, your name and the address of your profile picture. We use them to sign you in and show whose account it is. Signing in with Google is the only way in; we never see your Google password.</li>
        <li><strong>Sign-in sessions:</strong> for each device you sign in on, when it started and was last used, its IP address and its browser’s user agent, so sessions can be checked and ended (Sign out everywhere).</li>
        <li><strong>Your songs:</strong> each project’s code and saved versions, the chat with the assistant (what you asked, its replies and the changes it suggested), the sounds you upload and the audio you export.</li>
        <li><strong>Usage and plan:</strong> how much of your AI allowance each reply used (including replies you stopped and ones that failed part-way), which plan you are on and when it renews (from Polar), and which version of these pages you last saw.</li>
        <li><strong>Account events:</strong> the steps of getting started (signed up, first project, trial started, subscribed, cancelled), when a chat was refused because a limit was reached, and which account emails we sent you and when, so each is sent only once.</li>
        <li><strong>Operator actions:</strong> if we suspend an account or give it Pro, the reason and a record of the action. That record names your account only by its id and is kept after the account is deleted, without your email address.</li>
        <li><strong>Short-lived records:</strong> request counts that stop abuse (deleted after a day), and our servers’ logs. The web server logs your IP address, the page requested and your browser; the app’s own logs name your account only as a one-way hash and never contain your email, song code or chat. Logs are rotated and kept for a few weeks at most.</li>
      </ul>

      <h2>Who else processes it</h2>
      <ul>
        <li><strong>Hetzner</strong> (Germany) hosts the servers, the database and your files, and stores our encrypted backups.</li>
        <li><strong>Google</strong> confirms who you are when you sign in.</li>
        <li><strong>Anthropic</strong> (USA) runs the AI model. When you ask the assistant something, your message, your song’s code and the recent chat are sent to Anthropic’s API to write the reply. Under Anthropic’s commercial terms that data is not used to train their models.</li>
        <li><strong>Polar</strong> is the merchant of record for Pro: it takes your card and billing details, charges you and handles tax. We only learn your plan, its status and when it renews.</li>
        <li><strong>{EMAIL_PROVIDER}</strong> delivers the emails we send you about your account and billing (welcome, your trial and allowance, a failed payment); it gets your email address and the message.</li>
        <li><strong>Sentry</strong> (error tracking), when we have it switched on, receives a technical report when something breaks: what failed, the page (without its query string), your browser, and your account as a one-way hash. Reports carry no request contents, cookies, song code or chat, and email addresses are removed from them.</li>
        {umamiHost && <li><strong>Umami</strong> counts page views for us ({umamiHost}): the page (without its query string), the referring site, your browser, device type and country. It sets no cookies, does not follow you across sites, and does not count you if your browser sends Do Not Track.</li>}
      </ul>
      <p>Searching for examples inside the app runs on our own servers. Projects are private to your account; nobody else sees your songs. We do not sell your data, share it with advertisers, or use it for anything other than running Shawarma.</p>

      <h2>Your browser</h2>
      <p>The app, its fonts and its built-in sounds come from our own server. The only other places your browser contacts are Google (for sign-in, and to show your profile picture from googleusercontent.com), Polar (when you open checkout or Manage billing){umamiHost ? <>, {umamiHost} (Umami’s page counts)</> : null} and, when error tracking is on, Sentry (only when something breaks).</p>
      <p>We use one cookie to keep you signed in (<code>shawarma_session</code>, up to 30 days) and a short-lived one during Google sign-in. No advertising cookies, no cross-site trackers{umamiHost ? ', and the page counts above use no cookies' : ', no analytics'}. The app also keeps a few things in your browser’s own storage, such as unsaved edits and the panel layout; they never leave your device.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Everything above stays while your account exists.</li>
        <li>A project you delete goes to the trash; you can restore it for 30 days, then it and its files are removed for good. Delete forever removes it at once.</li>
        <li>When you delete your account, your account, projects, chats, usage and files are deleted at once. Copies in our encrypted backups are removed as the backups age out, within {BACKUP_RETENTION}.</li>
        <li>Billing records stay with Polar as tax law requires.</li>
      </ul>

      <h2>Your choices</h2>
      <p>In the app, under Account, you can download a copy of all your data (Export my data), end every session (Sign out everywhere), and delete your account. You can also write to <Mail subject="My Shawarma data" /> from the email address you sign in with, for anything else: a correction, a question, or if you can no longer sign in.</p>

      <h2>Changes</h2>
      <p>If this page changes in a way that matters, we will tell you in the app before the change takes effect.</p>
    </DocPage>
  );
}

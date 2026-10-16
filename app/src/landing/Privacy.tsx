import { LEGAL_VERSIONS } from '@shawarma/shared';
import { DocPage, Mail, type DocPageProps, legalDate } from './DocPage';
import { OPERATOR } from './Terms';

// Every statement here should match what the code and the hosted setup do (server/src/auth/sessions.ts,
// server/migrations, deploy/backup.sh, deploy/docker-compose.yml). Bump LEGAL_VERSIONS.privacy
// (@shawarma/shared) whenever this page changes in a way that matters.
//
// INTEGRATION (agent C, 2026-10-16), confirm before shipping:
//  - Email through Resend and an error tracker: keep each bullet only if that service actually ships
//    (EMAIL_PROVIDER / ERROR_TRACKER below; set to null to drop the bullet).
//  - "Sounds come from our own server": true once the sample packs and GM soundfonts are self-hosted (the
//    hosted build used to fetch them from strudel.b-cdn.net and felixroos.github.io). Verify in the
//    browser's network panel that the hosted app contacts no other origin than listed under "Your browser".
//  - Backup retention below follows `restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12`.
const EMAIL_PROVIDER: string | null = 'Resend';
const ERROR_TRACKER: string | null = 'an error-tracking service';
export const BACKUP_RETENTION = '12 months';

export function Privacy({ links }: DocPageProps) {
  return (
    <DocPage title="Privacy" updated={legalDate(LEGAL_VERSIONS.privacy)} links={links}>
      <p>This page says what Shawarma REPL keeps about you, why, who else sees it, and for how long. Shawarma is run by {OPERATOR}; write to <Mail subject="My Shawarma data" /> about anything here.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Your Google account basics:</strong> Google’s id for your account, your email address, your name and the address of your profile picture. We use them to sign you in and show whose account it is. Signing in with Google is the only way in; we never see your Google password.</li>
        <li><strong>Sign-in sessions:</strong> for each device you sign in on, when it started and was last used, its IP address and its browser’s user agent, so sessions can be checked and ended (Sign out everywhere).</li>
        <li><strong>Your songs:</strong> each project’s code and saved versions, the chat with the assistant (what you asked, its replies and the changes it suggested), the sounds you upload and the audio you export.</li>
        <li><strong>Usage and plan:</strong> how much of your AI allowance each reply used, which plan you are on and when it renews (from Polar), and which version of these pages you last saw.</li>
        <li><strong>Short-lived records:</strong> request counts that stop abuse (deleted after a day), and our web server’s logs (IP address, page requested, browser), which are rotated and kept for a few weeks at most.</li>
      </ul>

      <h2>Who else processes it</h2>
      <ul>
        <li><strong>Hetzner</strong> (Germany) hosts the servers, the database and your files, and stores our encrypted backups.</li>
        <li><strong>Google</strong> confirms who you are when you sign in.</li>
        <li><strong>Anthropic</strong> (USA) runs the AI model. When you ask the assistant something, your message, your song’s code and the recent chat are sent to Anthropic’s API to write the reply. Under Anthropic’s commercial terms that data is not used to train their models.</li>
        <li><strong>Polar</strong> is the merchant of record for Pro: it takes your card and billing details, charges you and handles tax. We only learn your plan, its status and when it renews.</li>
        {EMAIL_PROVIDER && <li><strong>{EMAIL_PROVIDER}</strong> delivers the emails we send you about your account and billing; it gets your email address and the message.</li>}
        {ERROR_TRACKER && <li>When something breaks, {ERROR_TRACKER} receives a technical error report (what failed, your browser, the page). We keep song code and chat out of these reports.</li>}
      </ul>
      <p>Searching for examples inside the app runs on our own servers. Projects are private to your account; nobody else sees your songs. We do not sell your data, share it with advertisers, or use it for anything other than running Shawarma.</p>

      <h2>Your browser</h2>
      <p>The app, its fonts and its built-in sounds come from our own server. The only other places your browser contacts are Google (for sign-in, and to show your profile picture) and Polar (when you open checkout or Manage billing).</p>
      <p>We use one cookie to keep you signed in (<code>shawarma_session</code>, up to 30 days) and a short-lived one during Google sign-in. No analytics, no advertising cookies, no trackers. The app also keeps a few things in your browser’s own storage, such as unsaved edits and the panel layout; they never leave your device.</p>

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

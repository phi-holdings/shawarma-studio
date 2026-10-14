import { DocPage, Mail, type DocPageProps } from './DocPage';

export function Privacy({ links }: DocPageProps) {
  return (
    <DocPage title="Privacy" updated="13 October 2026" links={links}>
      <p>This page says what Shawarma REPL keeps about you, why, and who else sees it. It is short because we keep little.</p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Your Google account basics:</strong> your email address, your name and profile picture, and Google’s id for your account. We use them to sign you in and to show whose account it is. We never see your Google password.</li>
        <li><strong>Your songs:</strong> the code of each project, its saved versions, the sounds you upload and the audio files you export.</li>
        <li><strong>Your chats with Shawarma:</strong> what you asked, what Shawarma replied and the changes it suggested, so you can scroll back and undo things.</li>
        <li><strong>Usage:</strong> how much of your monthly AI allowance each reply used, and which plan you are on.</li>
        <li><strong>A sign-in cookie,</strong> so you stay signed in, and short-lived request counts that stop abuse. We do not use advertising cookies.</li>
      </ul>

      <h2>Who else sees it</h2>
      <ul>
        <li><strong>Anthropic.</strong> When you ask Shawarma for something, your message, your song’s code and the recent chat are sent to Anthropic’s API so its model can write the reply. Under Anthropic’s commercial terms, that data is not used to train their models.</li>
        <li><strong>Polar.</strong> If you subscribe, Polar handles the payment. Polar stores your card and billing details; we only learn which plan you are on and when it renews.</li>
        <li><strong>Google,</strong> only to confirm who you are when you sign in.</li>
      </ul>
      <p>Searching for examples inside the app runs on our own servers; your songs are not sent to a search service. Nobody else sees your songs: projects are private to your account.</p>
      <p>We do not sell your data, share it with advertisers, or use it for anything other than running Shawarma.</p>

      <h2>Getting a copy or deleting it</h2>
      <p>Write to <Mail subject="My Shawarma data" /> from the email address you sign in with. We will send you a copy of your songs and chats, or delete your account and everything in it, whichever you ask for. Payment records that Polar must keep for tax reasons stay with Polar.</p>

      <h2>Changes</h2>
      <p>If this page changes in a way that matters, we will tell you in the app before it takes effect.</p>
    </DocPage>
  );
}

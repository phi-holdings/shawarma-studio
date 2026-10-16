import { LEGAL_VERSIONS } from '@shawarma/shared';
import { DocPage, Mail, type DocPageProps, legalDate } from './DocPage';
import { DEFAULT_PRICES, TRIAL_DAYS, usd } from './proPrices';

// CONFIRM WITH OWNER before launch: the operator ("phi holdings", owner Ali AlAbdulbaqi) and the governing
// law (Kingdom of Saudi Arabia, courts of Dammam) below are the owner's stated intent, not a lawyer's
// review. Bump LEGAL_VERSIONS.terms (@shawarma/shared) whenever this page changes in a way that matters.
export const OPERATOR = 'phi holdings';
export const OPERATOR_OWNER = 'Ali AlAbdulbaqi';

export function Terms({ links }: DocPageProps) {
  const pricing = links?.pricing ?? '/pricing';
  return (
    <DocPage title="Terms" updated={legalDate(LEGAL_VERSIONS.terms)} links={links}>
      <p>These terms are the agreement between you and {OPERATOR} (owned by {OPERATOR_OWNER}), who runs Shawarma REPL (“Shawarma”, “we”). By signing in you agree to them. Questions go to <Mail subject="Shawarma terms" />.</p>

      <h2>Who can use it</h2>
      <p>You must be at least 18. You sign in with a Google account; that is the only way in. If you lose access to it, write to us from another address and we will help where we can confirm the account is yours. One account per person; keep your sign-in to yourself.</p>

      <h2>Your songs are yours</h2>
      <p>You own what you make: your code, the sounds you upload, the audio you export, and the suggestions from the assistant that you keep. You give us permission to store and process them only to run the service for you (saving versions, playing, checking and exporting songs, and sending your requests to the assistant). We do not claim any ownership and do not use your songs for anything else.</p>

      <h2>What the assistant writes</h2>
      <p>The assistant’s suggestions come from an AI model. You may use what it writes for any purpose, including commercially, and we claim no ownership of it. We cannot promise it is original or free of others’ rights: similar code or melodies can come up for other people, and it can be wrong or break your song. Nothing changes until you accept it, and every version is kept.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Nothing illegal, and nothing that harms or harasses other people.</li>
        <li>Only upload sounds you have the right to use. Don’t upload samples that infringe someone else’s rights.</li>
        <li>Don’t abuse the assistant: no automated scripts, no getting around the allowance, no using it for things unrelated to making music in Shawarma.</li>
        <li>Don’t try to break out of the sandbox that runs songs, reach other people’s data, or overload or attack the service.</li>
      </ul>
      <p>We may suspend or close an account that breaks these rules. Where we can, we will tell you why first and let you download your songs.</p>

      <h2>Plans and payments</h2>
      <p>The free plan includes the editor, sounds and export, with limits on projects and storage. Pro adds the assistant, more projects and more storage, for {usd(DEFAULT_PRICES.month)} a month or {usd(DEFAULT_PRICES.year)} a year (current prices on the <a href={pricing}>pricing page</a>). Payments are handled by Polar, the merchant of record: Polar sells you the subscription, charges your card, and handles tax and invoices.</p>
      <ul>
        <li><strong>Trial.</strong> Pro starts with a {TRIAL_DAYS}-day free trial, once per person. You add a card at checkout; it is charged when the trial ends unless you cancel before then.</li>
        <li><strong>Renewal.</strong> Pro renews automatically every month or year until you cancel.</li>
        <li><strong>Cancelling.</strong> Cancel any time from Manage billing in the app. It takes effect at the end of the period you paid for; you keep Pro until then and are not charged again.</li>
        <li><strong>Refunds.</strong> Refunds follow Polar’s refund policy. We also look at requests case by case: write to <Mail subject="Shawarma refund" />.</li>
        <li><strong>Price changes</strong> apply from your next renewal, and we tell you in the app before then.</li>
      </ul>

      <h2>Allowance and fair use</h2>
      <p>Pro includes a monthly allowance of assistant use (the trial a smaller one). When it runs out, the editor, playback and export keep working; the assistant waits until the allowance resets. To keep the service running for everyone, the assistant may pause for a day when overall use is very high. If you had more projects or files than your plan keeps, they stay; you just can’t add more until you are under the limit.</p>

      <h2>Changes to the service, and ending it</h2>
      <p>We may change, add or remove features. You can stop using Shawarma and delete your account at any time from Account in the app. If we ever shut the service down, we will give at least 30 days’ notice in the app so you can export your songs, and refund any unused prepaid time.</p>

      <h2>No guarantees</h2>
      <p>Shawarma is provided as it is, without warranties of any kind, to the extent the law allows. Keep your own copies of work that matters to you (Export my data and audio export make that easy). Our total liability to you for anything related to the service is limited to what you paid us in the 12 months before the claim, and we are not liable for indirect losses such as lost profits or lost work, except where the law does not allow such limits.</p>

      <h2>The software</h2>
      <p>The editor you use in the browser is free software under the GNU Affero General Public License, built on Strudel; the <a href={links?.source ?? '/source'}>source code page</a> says how to get it. The rest of the service (the assistant, accounts and billing) is not. That licence covers the editor’s code; these terms cover the hosted service.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of the Kingdom of Saudi Arabia, and the courts of Dammam have jurisdiction, except where the law of your country gives you rights that cannot be taken away.</p>

      <h2>Changes to these terms</h2>
      <p>If these terms change in a way that matters, we will tell you in the app before the change takes effect. Using Shawarma after that means you accept the new terms; if you don’t, you can cancel and delete your account.</p>
    </DocPage>
  );
}

// The public pricing page (/pricing): Free and Pro side by side, the trial, and the tax note. Prerendered
// with DEFAULT_PRICES; the page script (seo/client.ts) puts in the server's numbers (GET /api/pricing)
// when they differ, through the data-price attributes.
import { DocPage, type DocPageProps } from './DocPage';
import { DEFAULT_PRICES, TRIAL_DAYS, usd, VAT_NOTE, yearlySaving } from './proPrices';

export function Pricing({ links, signInHref = '/auth/google' }: DocPageProps & { signInHref?: string }) {
  const saving = yearlySaving(DEFAULT_PRICES);
  return (
    <DocPage title="Pricing" links={links} wide>
      <p className="ld-lede">The editor is free. The assistant comes with Pro, and you can try Pro free for {TRIAL_DAYS} days.</p>

      <div className="ld-plans">
        <section className="ld-plan" aria-labelledby="plan-free">
          <h2 id="plan-free">Free</h2>
          <p className="ld-price"><span>$0</span></p>
          <ul>
            <li>The Strudel editor, live playback and the built-in sounds</li>
            <li>WAV and MP3 export</li>
            <li>3 projects and 200 MB of files</li>
            <li>No assistant</li>
          </ul>
          <a className="ld-pill ld-pill-line" href={signInHref}>Start free</a>
        </section>

        <section className="ld-plan ld-plan-pro" aria-labelledby="plan-pro">
          <h2 id="plan-pro">Pro</h2>
          <p className="ld-price">
            <span data-price="month">{usd(DEFAULT_PRICES.month)}</span> a month
            <span className="ld-or"> or <span data-price="year">{usd(DEFAULT_PRICES.year)}</span> a year{saving && <span data-price="saving"> ({saving})</span>}</span>
          </p>
          <ul>
            <li>Everything in Free</li>
            <li>The assistant: ask for changes in plain words, with a monthly allowance</li>
            <li>Think deeper, for harder changes</li>
            <li>200 projects and 2 GB of files</li>
          </ul>
          <a className="ld-pill" href={signInHref}>Try Pro free for {TRIAL_DAYS} days</a>
          <p className="ld-plan-note">{TRIAL_DAYS} days free, then <span data-price="month">{usd(DEFAULT_PRICES.month)}</span> a month (or the yearly price if you pick it). You add a card at checkout and can cancel any time before the trial ends to pay nothing. One trial per person.</p>
        </section>
      </div>

      <h2>Good to know</h2>
      <ul>
        <li>{VAT_NOTE}</li>
        <li>Cancel any time from Manage billing in the app. You keep Pro until the end of the period you paid for.</li>
        <li>When the month’s assistant allowance runs out, everything else keeps working; it resets with your billing month. The trial includes a smaller allowance.</li>
        <li>Refunds and the rest of the rules: <a href={links?.terms ?? '/terms'}>Terms</a>.</li>
      </ul>
    </DocPage>
  );
}

// Hosted Shawarma end to end, against the local fakes: landing -> Continue with Google (fake provider) ->
// app -> new project -> chat refused on Free with "Start 7-day free trial" -> fake Polar "Start trial
// (test)" -> on the trial, chat works (fake AI) -> the trial's allowance used up -> Manage billing ->
// "End trial now" in the fake portal -> Pro's allowance and Think deeper -> sign out -> landing.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { databaseUrl, oidcPort, polarPort } from './env';

// pg lives in the server package
type PgClient = { connect(): Promise<void>; query(sql: string, values?: unknown[]): Promise<unknown>; end(): Promise<void> };
const pg = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/package.json'))('pg') as {
  Client: new (o: { connectionString: string }) => PgClient;
};

async function seedUsage(email: string, usd: number) {
  const c = new pg.Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    await c.query(
      `insert into usage_events (user_id, model, input_tokens, output_tokens, cost_usd, created_at)
       select id, 'claude-opus-5-5', 1000, 100, $2, now() from users where email = $1`,
      [email, usd],
    );
  } finally { await c.end(); }
}

const send = async (page: Page, text: string) => {
  await page.getByPlaceholder('make the drop heavier…').fill(text);
  await page.getByRole('button', { name: /Send/ }).click();
};

test('sign in, chat refused on Free, start the trial, use up its AI, end the trial, Pro, sign out', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  // signed out: the landing page
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Write songs in code');
  await page.getByRole('link', { name: /Continue with Google/ }).first().click();

  // the fake Google
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${oidcPort}/authorize`));
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Name' }).fill('Hosted Tester');
  await page.getByRole('button', { name: 'Sign in as this person' }).click();

  // the app, with the account in the sidebar
  const account = page.getByRole('button', { name: /^Account: Hosted Tester, Free plan$/ });
  await expect(account).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();

  // a new project
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill('Hosted song');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 2, name: /Hosted song/ })).toBeVisible();
  await page.evaluate(() => (window as any).__editor.current.setCode('s("bd sd hh*8")'));

  // only the cleanly licensed sample packs: the runtime is told so, the sound browser has no drum
  // machines, and the song check calls them unknown
  await expect(page.locator('iframe.runtime-frame')).toHaveAttribute('src', /[?&]p=hosted(&|$)/);
  await page.getByRole('tab', { name: 'Sounds' }).click();
  await expect(page.getByText('Loading sounds from the song runtime…')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Play bd', exact: true }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('tr808');
  await expect(page.getByText('RolandTR808', { exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('mridangam');
  await expect(page.getByRole('button', { name: /^Play ta \(mridangam\)$/i }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('');
  const issues = await page.evaluate(async () => {
    const res = await fetch('/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'stack(s("bd sd").bank("RolandTR909"), s("casio"), s("hh"))' }) });
    return ((await res.json()) as { issues: { kind: string; message: string }[] }).issues;
  });
  expect(issues.map((i) => i.kind)).toEqual(['unknown_sound']);
  for (const n of ['RolandTR909_bd', 'RolandTR909_sd', 'casio']) expect(issues[0].message).toContain(n);
  await page.getByRole('tab', { name: 'Code' }).click();

  // Free has no AI: chat is refused with the trial action, and Think deeper is locked
  await expect(page.locator('label.toggle', { hasText: 'Think deeper' }).locator('input')).toBeDisabled();
  await send(page, 'add a clap');
  const refusal = page.locator('.msg.err', { hasText: "Shawarma's AI comes with Pro. Start a 7-day free trial to use it" });
  await expect(refusal).toBeVisible();
  await account.click();
  await expect(page.getByText('No AI on Free')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Start 7-day free trial' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Start 7-day free trial -> the fake Polar checkout (card kept, $0 today) -> back on Pro's trial
  await refusal.getByRole('button', { name: 'Start 7-day free trial' }).click();
  const upgrade = page.getByRole('dialog', { name: 'Start 7-day free trial' });
  await expect(upgrade.getByText(/charged when the trial ends/)).toBeVisible();
  await upgrade.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/checkout/`));
  await expect(page.getByText('7-day free trial: $0.00 today')).toBeVisible();
  await page.getByRole('button', { name: 'Start trial (test)' }).click();
  await expect(page).toHaveURL(/\/billing\/success\?checkout_id=/);
  await expect(page.getByRole('heading', { name: 'Your free trial has started.' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to your songs' }).click();

  // on the trial: chat works (no dollar amounts in hosted mode); Think deeper waits for paid Pro
  const proAccount = page.getByRole('button', { name: /^Account: Hosted Tester, Pro plan$/ });
  await expect(proAccount).toBeVisible();
  await expect(proAccount).toContainText('Pro trial');
  await page.getByRole('button', { name: 'Hosted song', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Hosted song/ })).toBeVisible();
  await expect(page.locator('label.toggle', { hasText: 'Think deeper' }).locator('input')).toBeDisabled();
  await send(page, 'add a clap');
  await expect(page.getByText('Added a clap after the snare.')).toBeVisible();
  await expect(page.locator('.chat-cost')).toHaveCount(0);

  // the trial's AI runs out
  await seedUsage(email, 1);
  await send(page, 'more');
  await expect(page.locator('.msg.err', { hasText: "You've used the AI that comes with the free trial. Pro's full monthly allowance starts when your trial ends on" })).toBeVisible();
  await proAccount.click();
  await expect(page.getByText("100% of the trial's AI used")).toBeVisible();

  // Manage billing -> the fake portal -> end the trial now (charged, active) -> back to Shawarma
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/portal/`));
  await expect(page.getByText(/Shawarma Pro · trialing/)).toBeVisible();
  await page.getByRole('button', { name: 'End trial now (charge)' }).click();
  await expect(page.getByText(/Shawarma Pro · active, renews/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();

  // paid Pro: a fresh monthly allowance and Think deeper
  await expect(proAccount).toBeVisible();
  await expect(proAccount).not.toContainText('trial');
  await page.getByRole('button', { name: 'Hosted song', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Hosted song/ })).toBeVisible();
  await expect(page.locator('label.toggle', { hasText: 'Think deeper' }).locator('input')).toBeEnabled();
  await send(page, 'add a clap again');
  await expect(page.getByText('Added a clap after the snare.')).toHaveCount(2);
  await expect(page.locator('.msg.err')).toHaveCount(0);
  await proAccount.click();
  await expect(page.getByText(/^\d+% of this month's AI used$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // sign out: the landing page again, and the API refuses the old session
  await page.goto('/');
  await page.getByRole('button', { name: /^Account: Hosted Tester, Pro plan$/ }).click();
  // the AGPL source offer, privacy and terms are one click away for signed-in people too
  const about = page.getByRole('navigation', { name: 'About Shawarma' });
  await expect(about.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', '/source');
  await expect(about.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(about.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: /Continue with Google/ }).first()).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('a cancelled sign-in comes back to the landing page with a plain message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Continue with Google/ }).first().click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/\?error=access_denied$/);
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled. Continue with Google to try again.');
});

test('the public pages render for everyone', async ({ page }) => {
  for (const [p, heading] of [['/privacy', /Privacy/], ['/terms', /Terms/], ['/source', /source/i]] as const) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
  // the sound credits the CC BY licences ask for
  await expect(page.getByRole('link', { name: 'Salamander Grand Piano V3' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeVisible();
  await expect(page.getByText('tidal-drum-machines')).toHaveCount(0);
});

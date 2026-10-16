// Hosted Shawarma end to end, against the local fakes: landing -> Continue with Google (fake provider) ->
// app -> new project -> chat (fake AI) -> allowance used up -> Upgrade -> fake Polar "Pay (test)" ->
// back on Pro -> chat works again -> Manage billing opens the portal -> sign out -> landing.
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
       select id, 'claude-opus-5-5', 1000, 100, $2, now() - interval '1 minute' from users where email = $1`,
      [email, usd],
    );
  } finally { await c.end(); }
}

const send = async (page: Page, text: string) => {
  await page.getByPlaceholder('make the drop heavier…').fill(text);
  await page.getByRole('button', { name: /Send/ }).click();
};

test('sign in, chat, hit the allowance, upgrade through Polar, chat again, sign out', async ({ page }) => {
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

  // chat with the (fake) assistant; no dollar amounts in hosted mode; Think deeper is Pro only
  await expect(page.locator('label.toggle', { hasText: 'Think deeper' }).locator('input')).toBeDisabled();
  await send(page, 'add a clap');
  await expect(page.getByText('Added a clap after the snare.')).toBeVisible();
  await expect(page.locator('.chat-cost')).toHaveCount(0);

  // the allowance runs out
  await seedUsage(email, 5);
  await send(page, 'more');
  const refusal = page.locator('.msg.err', { hasText: "You've used this month's AI allowance. Upgrade to Pro, or it resets on" });
  await expect(refusal).toBeVisible();
  await account.click();
  await expect(page.getByText("100% of this month's AI used")).toBeVisible();
  await page.keyboard.press('Escape');

  // Upgrade -> the fake Polar checkout -> back to Shawarma on Pro
  await refusal.getByRole('button', { name: 'Upgrade to Pro' }).click();
  const upgrade = page.getByRole('dialog', { name: 'Upgrade to Pro' });
  await upgrade.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/checkout/`));
  await page.getByRole('button', { name: 'Pay (test)' }).click();
  await expect(page).toHaveURL(/\/billing\/success\?checkout_id=/);
  await expect(page.getByRole('heading', { name: "You're on Pro." })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to your songs' }).click();

  // Pro: a fresh allowance and Think deeper
  await expect(page.getByRole('button', { name: /^Account: Hosted Tester, Pro plan$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Hosted song', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Hosted song/ })).toBeVisible();
  await expect(page.locator('label.toggle', { hasText: 'Think deeper' }).locator('input')).toBeEnabled();
  await send(page, 'add a clap again');
  await expect(page.getByText('Added a clap after the snare.').last()).toBeVisible();
  await expect(page.getByText('Added a clap after the snare.')).toHaveCount(2);
  await expect(page.locator('.msg.err')).toHaveCount(0);

  // Manage billing opens the (fake) customer portal
  await page.getByRole('button', { name: /^Account: Hosted Tester, Pro plan$/ }).click();
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/portal/`));
  await expect(page.getByText(/Shawarma Pro/).first()).toBeVisible();

  // back, sign out: the landing page again, and the API refuses the old session
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
});

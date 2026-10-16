// Hosted mode: the Account page (export my data, sign out everywhere, delete my account), the Trash,
// prices in the upgrade dialog, the failed-payment banner and the Terms/Privacy notice; the public pages
// (pricing, legal) on a phone-sized screen, and the editor's "larger screen" note there.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { databaseUrl, oidcPort, polarPort } from './env';

type PgClient = { connect(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> };
const pg = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/package.json'))('pg') as {
  Client: new (o: { connectionString: string }) => PgClient;
};
async function sql(text: string, values: unknown[] = []) {
  const c = new pg.Client({ connectionString: databaseUrl });
  await c.connect();
  try { return (await c.query(text, values)).rows; } finally { await c.end(); }
}

async function signIn(page: Page, email: string, opts: { editor?: boolean } = {}) {
  await page.goto('/');
  await page.getByRole('link', { name: /Continue with Google/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${oidcPort}/authorize`));
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Name' }).fill('Account Tester');
  await page.getByRole('button', { name: 'Sign in as this person' }).click();
  if (opts.editor !== false) await expect(page.locator('.cm-content')).toBeVisible();
}
const openAccount = async (page: Page) => {
  await page.getByRole('button', { name: /^Account: / }).click();
  await page.getByRole('button', { name: 'Account…' }).click();
  return page.getByRole('dialog', { name: 'Account' });
};

test('export my data, sign out everywhere, then delete the account', async ({ browser }) => {
  const email = `acct-${Date.now()}@example.com`;
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await signIn(b, email);

  // help & feedback is a mail to support with the build in it
  await a.getByRole('button', { name: /^Account: / }).click();
  const help = a.getByRole('link', { name: 'Help & feedback' });
  await expect(help).toHaveAttribute('href', /^mailto:shawarma@phi\.holdings\?subject=.*&body=.*Shawarma%200\.1\.0/);
  await a.keyboard.press('Escape');

  // export: a JSON download with the projects
  let dialog = await openAccount(a);
  const download = a.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export my data' }).click();
  const file = await (await download).path();
  const data = JSON.parse(await fs.readFile(file!, 'utf8'));
  expect(data.account.email).toBe(email);
  expect(data.projects.length).toBeGreaterThan(0);
  await expect(dialog.getByRole('status')).toHaveText('Your data is downloading.');

  // sign out everywhere: both browsers are signed out
  await dialog.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(a.getByRole('link', { name: /Continue with Google/ }).first()).toBeVisible();
  expect((await b.request.get('/api/me')).status()).toBe(401);

  // delete: refused while a trial would turn paid, then allowed once cancelled
  await signIn(a, email);
  const [{ id }] = await sql('select id from users where email = $1', [email]);
  await sql(`insert into subscriptions (user_id, plan, status, current_period_start, current_period_end) values ($1, 'pro', 'trialing', now(), now() + interval '7 days')`, [id]);
  dialog = await openAccount(a);
  await dialog.getByRole('button', { name: 'Delete my account…' }).click();
  const confirm = dialog.getByRole('button', { name: 'Delete my account for good' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type your email to confirm').fill(email);
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('Cancel it first (Manage billing)');
  await sql('update subscriptions set cancel_at_period_end = true where user_id = $1', [id]);
  await confirm.click();
  await expect(a.getByRole('link', { name: /Continue with Google/ }).first()).toBeVisible();
  expect(await sql('select 1 from users where email = $1', [email])).toEqual([]);
});

test('trash: delete a project, restore it, delete it forever', async ({ page }) => {
  await signIn(page, `trash-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name').fill('Binned song');
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(create).toBeHidden();
  await page.getByRole('button', { name: 'More actions for Binned song' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const del = page.getByRole('dialog', { name: 'Delete project' });
  await expect(del).toContainText("don't count toward your project limit");
  await del.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('button', { name: 'Binned song', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Trash' }).click();
  const trash = page.getByRole('dialog', { name: 'Trash' });
  await expect(trash.getByText('30 days left')).toBeVisible();
  await trash.getByRole('button', { name: 'Restore Binned song' }).click();
  await expect(trash.getByText('The trash is empty.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Binned song', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More actions for Binned song' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete project' }).getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Trash' }).click();
  await trash.getByRole('button', { name: 'Delete Binned song forever' }).click();
  await trash.getByRole('button', { name: 'Really delete Binned song forever' }).click();
  await expect(trash.getByText('The trash is empty.')).toBeVisible();
});

test('prices in the upgrade dialog; failed payment banner opens billing; the Terms notice', async ({ page }) => {
  const email = `pay-${Date.now()}@example.com`;
  await signIn(page, email);
  await page.getByRole('button', { name: /^Account: / }).click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Start 7-day free trial' }).click();
  const upgrade = page.getByRole('dialog', { name: 'Start 7-day free trial' });
  await expect(upgrade.getByText('$12 a month', { exact: true })).toBeVisible();
  await expect(upgrade.getByText('$120 a year (two months free)')).toBeVisible();
  await expect(upgrade.getByText('7 days free, then $12 a month.')).toBeVisible();
  await upgrade.getByText('Yearly').click();
  await expect(upgrade.getByText('7 days free, then $120 a year.')).toBeVisible();
  await expect(upgrade.getByText(/Prices exclude VAT where applicable/)).toBeVisible();
  await expect(upgrade.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  // start the trial through the fake Polar, then the payment fails in its portal
  await upgrade.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Start trial (test)' }).click();
  await page.getByRole('button', { name: 'Back to your songs' }).click();
  await page.getByRole('button', { name: /^Account: .*Pro plan$/ }).click();
  await expect(page.getByText(/^Trial ends .*; you'll be charged \$120\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await page.getByRole('button', { name: 'End trial now (charge)' }).click();
  await page.getByRole('button', { name: 'Payment fails' }).click();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();
  const banner = page.getByRole('alert').filter({ hasText: 'Payment failed. Update your card by' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Update card' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/portal/`));
  await page.getByRole('button', { name: 'Payment succeeds' }).click();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByText('Payment failed.')).toHaveCount(0);

  // Terms changed since this person accepted them: a notice until dismissed
  await sql(`update users set terms_version = '2000-01-01' where email = $1`, [email]);
  await page.reload();
  const notice = page.getByRole('status').filter({ hasText: 'We updated our' });
  await expect(notice.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByText('We updated our')).toHaveCount(0);
});

async function phone(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
}
const noSideScroll = (page: Page) => page.evaluate(() => {
  const el = document.querySelector('.landing') ?? document.documentElement;
  return el.scrollWidth <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
});

test('public pages fit a 390px phone; the editor says it needs a larger screen', async ({ browser }) => {
  const page = await phone(browser);
  for (const [p, heading] of [['/', 'Write songs in code'], ['/pricing', 'Pricing'], ['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/source', 'Source code']] as const) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    expect(await noSideScroll(page), p).toBe(true);
  }
  // pricing: both plans, the prices, and the tax note
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Free', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro', level: 2 })).toBeVisible();
  await expect(page.getByText('$120', { exact: true })).toBeVisible();
  await expect(page.getByText(/Prices exclude VAT where applicable/)).toBeVisible();
  // terms and privacy name who runs it and how to leave
  await page.goto('/terms');
  await expect(page.getByText(/agreement between you and phi holdings/)).toBeVisible();
  await expect(page.getByText(/laws of the Kingdom of Saudi Arabia/)).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByText(/within 12 months/)).toBeVisible();

  // signed in on a phone: a clear note instead of a cramped editor, and a way past it
  await signIn(page, `phone-${Date.now()}@example.com`, { editor: false });
  const note = page.getByRole('note');
  await expect(note.getByRole('heading', { name: 'Shawarma is best on a larger screen' })).toBeVisible();
  await expect(page.locator('.app')).toBeHidden();
  await note.getByRole('button', { name: 'Show the editor anyway' }).click();
  await expect(page.locator('.app')).toBeVisible();
});

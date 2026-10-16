// The whole paid path on the merged build, one person from sign-up to deleting their account: sign in
// (fake Google) -> welcome state -> chat refused on Free with the trial button -> prices in the upgrade
// dialog -> trial (fake Polar) -> chat works -> a reply stopped mid-stream is still paid for -> the
// trial's AI used up -> trial ended and charged -> a failed renewal shows the past_due banner, then the
// card works -> paid Pro -> export a short song -> trash and restore a project -> export my data -> sign
// out everywhere -> delete refused while subscribed -> cancel -> delete. Plus: only an admin gets /admin.
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

async function signIn(page: Page, email: string, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /Continue with Google/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${oidcPort}/authorize`));
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Sign in as this person' }).click();
}
const fresh = async (browser: Browser) => (await browser.newContext()).newPage();
const send = async (page: Page, text: string) => {
  await page.getByPlaceholder('make the drop heavier…').fill(text);
  await page.getByRole('button', { name: /Send/ }).click();
};
const usageCount = async (email: string) =>
  (await sql('select count(*)::int as n from usage_events e join users u on u.id = e.user_id where u.email = $1', [email]))[0].n as number;
const openAccount = async (page: Page) => {
  await page.getByRole('button', { name: /^Account: / }).click();
  await page.getByRole('button', { name: 'Account…' }).click();
  return page.getByRole('dialog', { name: 'Account' });
};
const portal = async (page: Page) => {
  await page.getByRole('button', { name: /^Account: / }).click();
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/portal/`));
};
const openSong = async (page: Page, name: string) => {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(name) })).toBeVisible();
};

test('the whole paid path, sign-up to account deletion; admin only for admins', async ({ browser }) => {
  test.setTimeout(240_000);
  const email = `journey-${Date.now()}@example.com`;
  const page = await fresh(browser);

  // ---- sign in and the welcome state: Free, an empty editor, the welcome email queued, sign-up counted
  await signIn(page, email, 'Journey Person');
  const freeAccount = page.getByRole('button', { name: /^Account: Journey Person, Free plan$/ });
  await expect(freeAccount).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect.poll(async () => (await sql(`select l.kind from email_log l join users u on u.id = l.user_id where u.email = $1`, [email])).map((r) => r.kind))
    .toContain('welcome');
  expect((await sql(`select f.kind from funnel_events f join users u on u.id = f.user_id where u.email = $1`, [email])).map((r) => r.kind)).toContain('signup');

  await page.getByRole('button', { name: 'New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name').fill('Journey song');
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(create).toBeHidden();
  await expect(page.getByRole('heading', { level: 2, name: /Journey song/ })).toBeVisible();
  await page.evaluate(() => (window as any).__editor.current.setCode('setcpm(120)\ns("bd sd hh*8")'));

  // ---- Free: chat refused with the trial button
  await send(page, 'add a clap');
  const refusal = page.locator('.msg.err', { hasText: "Shawarma's AI comes with Pro" });
  await expect(refusal).toBeVisible();

  // ---- the upgrade dialog shows the prices (the server's PRICES), then the trial through the fake Polar
  await refusal.getByRole('button', { name: 'Start 7-day free trial' }).click();
  const upgrade = page.getByRole('dialog', { name: 'Start 7-day free trial' });
  await expect(upgrade.getByText('$12 a month', { exact: true })).toBeVisible();
  await expect(upgrade.getByText('$120 a year (two months free)')).toBeVisible();
  await expect(upgrade.getByText('7 days free, then $12 a month.')).toBeVisible();
  await upgrade.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/checkout/`));
  await page.getByRole('button', { name: 'Start trial (test)' }).click();
  await expect(page.getByRole('heading', { name: 'Your free trial has started.' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to your songs' }).click();
  const proAccount = page.getByRole('button', { name: /^Account: Journey Person, Pro plan$/ });
  await expect(proAccount).toContainText('Pro trial');

  // ---- on the trial, chat works
  await openSong(page, 'Journey song');
  await send(page, 'add a clap');
  await expect(page.getByText('Added a clap after the snare.')).toBeVisible();
  const afterReply = await usageCount(email);
  expect(afterReply).toBeGreaterThan(0);

  // ---- a reply stopped mid-stream: marked stopped, and what it used is recorded
  await send(page, 'e2e:hang write a longer groove');
  await expect(page.getByText('Working on a longer groove')).toBeVisible();
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.getByText('Stopped. Any edits made so far are below as a partial suggestion.')).toBeVisible();
  await expect.poll(() => usageCount(email)).toBe(afterReply + 1);

  // ---- the trial's AI used up: its own message
  await sql(`insert into usage_events (user_id, model, input_tokens, output_tokens, cost_usd) select id, 'claude-opus-5-5', 1000, 100, 1 from users where email = $1`, [email]);
  await send(page, 'more');
  await expect(page.locator('.msg.err', { hasText: "You've used the AI that comes with the free trial" })).toBeVisible();

  // ---- the trial ends (charged), the next payment fails: the past_due banner, Update card, it works
  await portal(page);
  await page.getByRole('button', { name: 'End trial now (charge)' }).click();
  await page.getByRole('button', { name: 'Payment fails' }).click();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();
  const banner = page.getByRole('alert').filter({ hasText: 'Payment failed. Update your card by' });
  await expect(banner).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/billing/status')).json());
  expect(status).toMatchObject({ plan: 'pro', status: 'past_due', paymentIssue: 'past_due', paymentGraceEndsAt: expect.any(String) });
  await banner.getByRole('button', { name: 'Update card' }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${polarPort}/portal/`));
  await page.getByRole('button', { name: 'Payment succeeds' }).click();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByText('Payment failed.')).toHaveCount(0);

  // ---- paid Pro: a fresh allowance, chat works again
  await expect(proAccount).toBeVisible();
  await expect(proAccount).not.toContainText('trial');
  await openSong(page, 'Journey song');
  await send(page, 'add a clap again');
  await expect(page.getByText('Added a clap after the snare.')).toHaveCount(2);

  // ---- export a short song (rendered in the browser, uploaded, kept in the person's storage)
  await page.evaluate(() => (window as any).__editor.current.setCode('setcpm(240)\ns("bd sd")'));
  await page.getByRole('button', { name: '⤓ Export' }).click();
  await expect(page.getByText(/Exported .*\.(wav|mp3)/)).toBeVisible({ timeout: 90_000 });
  expect((await sql(`select count(*)::int as n from exports e join projects p on p.id = e.project_id join users u on u.id = p.owner_id where u.email = $1`, [email]))[0].n)
    .toBeGreaterThan(0);

  // ---- trash a project and restore it
  await page.getByRole('button', { name: 'More actions for Journey song' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete project' }).getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('button', { name: 'Journey song', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Trash' }).click();
  const trash = page.getByRole('dialog', { name: 'Trash' });
  await trash.getByRole('button', { name: 'Restore Journey song' }).click();
  await expect(trash.getByText('The trash is empty.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Journey song', exact: true })).toBeVisible();

  // ---- admin: this person is refused, the admin gets the view
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
  const admin = await fresh(browser);
  await signIn(admin, 'e2e-admin@example.com', 'Admin Person');
  await expect(admin.locator('.cm-content')).toBeVisible();
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
  expect((await admin.request.get('/api/admin/users')).status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();

  // ---- export my data: the project, its chat, the plan and usage, the account events
  let dialog = await openAccount(page);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export my data' }).click();
  const data = JSON.parse(await fs.readFile((await (await download).path())!, 'utf8'));
  expect(data.account.email).toBe(email);
  expect(data.projects.map((p: { name: string }) => p.name)).toContain('Journey song');
  expect(data.projects.find((p: { name: string }) => p.name === 'Journey song').chat.length).toBeGreaterThan(0);
  expect(data.subscription).toMatchObject({ plan: 'pro', status: 'active' });
  expect(data.aiUsageByMonth.length).toBeGreaterThan(0);
  expect(data.files.some((f: { kind: string }) => f.kind.startsWith('export'))).toBe(true);
  expect(data.accountEvents.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['signup', 'trial_started']));

  // ---- sign out everywhere: this browser and a second one
  const other = await fresh(browser);
  await signIn(other, email, 'Journey Person');
  await expect(other.locator('.cm-content')).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByRole('link', { name: /Continue with Google/ }).first()).toBeVisible();
  expect((await other.request.get('/api/me')).status()).toBe(401);

  // ---- delete refused while the subscription renews; cancelled in billing, then it goes
  await signIn(page, email, 'Journey Person');
  await expect(page.locator('.cm-content')).toBeVisible();
  dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Delete my account…' }).click();
  await dialog.getByLabel('Type your email to confirm').fill(email);
  await dialog.getByRole('button', { name: 'Delete my account for good' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cancel it first (Manage billing)');
  await page.keyboard.press('Escape');
  await portal(page);
  await page.getByRole('button', { name: 'Cancel at period end' }).click();
  await expect(page.getByText(/Shawarma Pro · active, ends/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to Shawarma' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(async () => (await fetch('/api/billing/status')).json())).cancelAtPeriodEnd).toBe(true);
  dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Delete my account…' }).click();
  await dialog.getByLabel('Type your email to confirm').fill(email);
  await dialog.getByRole('button', { name: 'Delete my account for good' }).click();
  await expect(page.getByRole('link', { name: /Continue with Google/ }).first()).toBeVisible();
  expect(await sql('select 1 from users where email = $1', [email])).toEqual([]);
});

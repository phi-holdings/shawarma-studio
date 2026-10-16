// The admin view end to end: a non-admin is refused, the admin (SHAWARMA_ADMIN_EMAILS in
// playwright.hosted.config.ts) finds a user, comps Pro (the user's plan changes), suspends them (their
// next sign-in is refused with its own message) and sees the actions in the audit log.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { oidcPort } from './env';

async function signIn(page: Page, email: string, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /Continue with Google/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${oidcPort}/authorize`));
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Sign in as this person' }).click();
}
const fresh = async (browser: Browser) => (await browser.newContext()).newPage();

test('admin: refused for others; users, comp Pro, suspend, audit, spend and funnel', async ({ browser }) => {
  const member = `e2e-member-${Date.now()}@example.com`;
  const user = await fresh(browser);
  await signIn(user, member, 'Member Person');
  await expect(user.getByRole('button', { name: /^Account: Member Person, Free plan$/ })).toBeVisible();
  // no Admin link, and the page refuses
  await user.getByRole('button', { name: /^Account: Member Person/ }).click();
  await expect(user.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await user.goto('/admin');
  await expect(user.getByRole('heading', { name: 'Not allowed' })).toBeVisible();

  const admin = await fresh(browser);
  await signIn(admin, 'e2e-admin@example.com', 'Admin Person');
  await admin.getByRole('button', { name: /^Account: Admin Person/ }).click();
  await admin.getByRole('link', { name: 'Admin' }).click();
  await expect(admin.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
  await admin.getByRole('searchbox', { name: 'Search by email' }).fill(member);
  await admin.getByRole('button', { name: 'Search' }).click();
  await admin.getByRole('button', { name: member }).click();
  const detail = admin.getByRole('region', { name: `User ${member}` });
  await expect(detail).toContainText('Free');

  // comp Pro: the member is on Pro after a reload
  await detail.getByLabel('Comp Pro until').fill('2099-12-31');
  await detail.getByRole('button', { name: 'Comp Pro' }).click();
  await expect(detail).toContainText('Pro (comp)');
  await expect(detail.locator('.admin-audit')).toContainText('comp_pro by e2e-admin@example.com');
  await user.goto('/');
  await expect(user.getByRole('button', { name: /^Account: Member Person, Pro plan$/ })).toBeVisible();
  // the emails' Manage billing link: a comped account has no Polar customer, so it says so
  await user.goto('/billing/manage');
  await expect(user.getByRole('heading', { name: "Billing didn't open" })).toBeVisible();
  await expect(user.getByRole('status')).toContainText('There is no billing account yet');

  // suspend: signed out, and sign-in is refused
  admin.once('dialog', (d) => void d.accept());
  await detail.getByLabel('Reason').fill('e2e');
  await detail.getByRole('button', { name: 'Suspend' }).click();
  await expect(detail).toContainText('Suspended');
  await expect(detail.locator('.admin-audit')).toContainText('suspend by e2e-admin@example.com');
  await user.reload();
  await expect(user.getByRole('heading', { level: 1 })).toContainText('Write songs in code');
  await signIn(user, member, 'Member Person');
  await expect(user.getByRole('alert')).toContainText('This account is suspended');

  // spend and funnel
  await admin.getByRole('tab', { name: 'Spend' }).click();
  await expect(admin.getByRole('heading', { name: 'Top users, last 30 days' })).toBeVisible();
  await admin.getByRole('tab', { name: 'Funnel' }).click();
  await expect(admin.getByRole('cell', { name: 'signup' })).toBeVisible();
});

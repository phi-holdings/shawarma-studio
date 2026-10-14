import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { exportsDir } from './env';

/** The sidebar entry of a project (its name starts the button's name; "More actions for …" does not). */
const sidebarProject = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
/** Display name of the open project (the sidebar's current entry). */
const openProjectName = async (page: Page) =>
  ((await page.getByRole('navigation', { name: 'Projects' }).locator('[aria-current="page"] .project-name').textContent()) ?? '').trim();

// the app makes first-song only when there are no projects yet; specs that ran earlier may have made some
test.beforeEach(async ({ request }) => {
  const list = (await (await request.get('/api/projects')).json()) as { id: string }[];
  if (!list.some((p) => p.id === 'first-song')) await request.post('/api/projects', { data: { name: 'first-song' } });
});

test('select → run → ask → accept → export', async ({ page, request }) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  // other specs create projects too: open this one explicitly
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^first-song/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: /first-song/ })).toBeVisible();
  // typing would trigger CodeMirror's bracket auto-close, so set the code through the dev hook
  await page.evaluate(() => (window as any).__editor.current.setCode('setcpm(30)\narrange([2, s("bd sd")], [2, s("hh*8")])'));

  await expect(page.locator('.cm-section-widget.cm-sw-entry')).toHaveCount(2);

  // put the cursor inside "hh*8" and run it alone (snaps to s("hh*8"))
  await editor.getByText('hh*8').dblclick();
  await page.getByRole('button', { name: '▶ Run selection' }).click();
  await expect(page.getByText(/Running: s\("hh\*8"\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop song' }).first().click();

  // ask the (fake) AI, accept the diff
  await page.getByPlaceholder('make the drop heavier…').fill('add a clap');
  await page.getByRole('button', { name: /Send/ }).click();
  await page.getByRole('button', { name: /^Accept/ }).click();
  await expect(editor).toContainText('sd cp');

  // export and verify the file; the button stays disabled while the export runs
  const exportButton = page.getByRole('button', { name: '⤓ Export' });
  await exportButton.click();
  await expect(exportButton).toBeDisabled();
  await expect(page.getByText(/Exported .*\.wav/)).toBeVisible({ timeout: 90_000 });
  await expect(exportButton).toBeEnabled();
  const exports = await exportsDir(request, 'first-song');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(exports, 'first-song.wav')]).toString();
  expect(Number(probe)).toBeCloseTo(8, 1);   // 4 cycles at 0.5 cps
  // peak must sit at -1 dBFS (spec §8): ffmpeg volumedetect reports max_volume on stderr
  const vol = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(exports, 'first-song.wav'), '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString();
  const maxDb = Number(/max_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
  expect(maxDb).toBeLessThanOrEqual(-0.9);
  expect(maxDb).toBeGreaterThan(-1.5);
});

test('switching projects with unsaved edits asks first', async ({ page, request }) => {
  await request.post('/api/projects', { data: { name: 'zz-other', code: 's("cp")' } });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  const editorCode = () => page.evaluate(() => (window as any).__editor.current.getCode() as string);
  const current = await openProjectName(page);
  const other = current === 'zz-other' ? 'first-song' : 'zz-other';
  const otherCode = ((await (await request.get(`/api/projects/${other}`)).json()) as { code: string }).code;
  await page.evaluate(() => (window as any).__editor.current.setCode('s("bd bd bd")'));

  // declined: stay on the project, keep the edit
  let asked = 0;
  page.once('dialog', (d) => { asked++; void d.dismiss(); });
  await sidebarProject(page, other).click();
  await expect.poll(() => asked).toBe(1);
  await expect(sidebarProject(page, current)).toHaveAttribute('aria-current', 'page');
  expect(await editorCode()).toBe('s("bd bd bd")');

  // accepted: switch and load the other project's code
  page.once('dialog', (d) => { asked++; void d.accept(); });
  await sidebarProject(page, other).click();
  await expect(sidebarProject(page, other)).toHaveAttribute('aria-current', 'page');
  await expect.poll(editorCode).toBe(otherCode);
  expect(asked).toBe(2);

  // no edits: switching back does not ask
  page.on('dialog', (d) => { asked++; void d.dismiss(); });
  await sidebarProject(page, current).click();
  await expect(sidebarProject(page, current)).toHaveAttribute('aria-current', 'page');
  await expect.poll(editorCode).not.toBe(otherCode);
  expect(asked).toBe(2);
});

test('a rejected analysis upload shows up in the chat', async ({ page }) => {
  // stand-in chat stream that asks the browser for an analysis; the server then rejects the upload
  await page.route('**/api/projects/*/chat', (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: `data: ${JSON.stringify({ type: 'analysis_request', requestId: 'r1', code: 's("bd")', fromSec: 0, toSec: 1 })}\n\n`
      + `data: ${JSON.stringify({ type: 'done', costUsd: 0 })}\n\n`,
  }));
  await page.route('**/api/analysis/*', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid analysis body' }) }));
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByPlaceholder('make the drop heavier…').fill('how loud is it?');
  await page.getByRole('button', { name: /Send/ }).click();
  await expect(page.locator('.msg.err')).toContainText('invalid analysis body', { timeout: 30_000 });
});

test('settings: save and remove a key (fake AI: not verified, kept in memory)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toContainText('fake AI mode');
  const key = dialog.getByLabel('Anthropic API key');
  await expect(key).toHaveAttribute('type', 'password');
  await key.fill('sk-ant-api03-e2e-dummy-not-a-key-abcd');
  await dialog.getByRole('button', { name: 'Show' }).click();
  await expect(key).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Save key' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Key saved (…abcd)');
  await expect(key).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('sk-ant');
  await dialog.getByRole('button', { name: 'Remove key' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Key removed');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('without a key the chat shows a call-to-action and Send is disabled', async ({ page }) => {
  // the e2e server runs fake AI (chat works without a key); stand in a real-mode server with no key
  await page.route('**/api/settings', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ hasKey: false, keyHint: null, dailyCapUsd: 5, spentTodayUsd: 0, fakeAi: false }),
  }));
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByPlaceholder('make the drop heavier…').fill('add a clap');
  await expect(page.getByRole('button', { name: /Send/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Add your Anthropic API key' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('No key saved.');
});

test('a suggested change survives a page reload and can still be accepted', async ({ page, request }) => {
  const created = (await (await request.post('/api/projects', { data: { name: `reload-${Date.now()}`, code: 's("bd sd")' } })).json()) as { id: string; name: string };
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await sidebarProject(page, created.name).click();
  await expect.poll(() => page.evaluate(() => (window as any).__editor.current.getCode() as string)).toBe('s("bd sd")');
  await page.getByPlaceholder('make the drop heavier…').fill('add a clap');
  await page.getByRole('button', { name: /Send/ }).click();
  await expect(page.getByRole('button', { name: /^Accept/ })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await sidebarProject(page, created.name).click();
  const accept = page.getByRole('button', { name: /^Accept/ });
  await expect(accept).toBeEnabled({ timeout: 15_000 });
  await accept.click();
  await expect(page.locator('.cm-content')).toContainText('sd cp');

  // after another reload the card shows the decision instead of offering it again
  await page.reload();
  await sidebarProject(page, created.name).click();
  await expect(page.locator('.diffcard').last()).toContainText('Accepted.', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
});

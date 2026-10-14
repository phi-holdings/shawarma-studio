// Reviewing and accepting Claude's proposals (fake AI: "add a clap" turns "sd" into "sd cp" and, when the
// song has one, "hh*8" into "hh*16", so these songs get two separate changes).
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const SONG = 'setcpm(30)\nstack(\n  s("bd sd"),\n  note("c3 e3").s("sawtooth").gain(0.2),\n  note("g3").s("sawtooth").gain(0.2),\n  s("hh*8")\n)\n';

const editorCode = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);

async function openProject(page: Page, request: APIRequestContext, prefix: string, code = SONG) {
  const name = `${prefix}-${Date.now()}`;
  const created = (await (await request.post('/api/projects', { data: { name, code } })).json()) as { id: string };
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect.poll(() => editorCode(page)).toBe(code);
  return { id: created.id, name };
}

async function ask(page: Page, text = 'add a clap') {
  await page.getByPlaceholder('make the drop heavier…').fill(text);
  await page.getByRole('button', { name: /Send/ }).click();
  const card = page.locator('.diffcard.status-pending');
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

const project = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/projects/${id}`)).json()) as { code: string; versions: { source: string; message: string }[]; chat: any[] };

test('review in the editor: accept one change, reject the other', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'chunks');
  const card = await ask(page);
  await expect(card.locator('.hunk')).toHaveCount(2);
  await card.getByRole('button', { name: 'Review in editor' }).click();

  const bar = page.getByRole('toolbar', { name: 'Review Shawarma\'s change' });
  await expect(bar).toContainText('2 changes left');
  // the editor holds the proposal while you review it
  expect(await editorCode(page)).toContain('sd cp');
  await expect(card).toContainText('Reviewing in the editor');

  await page.getByRole('button', { name: 'Accept this change' }).first().click();
  await expect(bar).toContainText('1 change left');
  await page.getByRole('button', { name: 'Reject this change' }).first().click();
  await expect(bar).toBeHidden();

  await expect.poll(() => editorCode(page)).toContain('s("bd sd cp")');
  expect(await editorCode(page)).toContain('s("hh*8")');
  const done = page.locator('.diffcard').last();
  await expect(done).toContainText('Accepted 1 of 2 changes.');
  await expect(done.getByRole('button', { name: 'Revert this change' })).toBeVisible();

  const p = await project(request, id);
  expect(p.code).toContain('sd cp');
  expect(p.versions.at(-1)).toMatchObject({ source: 'ai', message: expect.stringContaining('(1 of 2 changes)') });
  expect(p.chat.at(-1)).toMatchObject({ role: 'decision', status: 'accepted', accepted: 1, total: 2 });
});

test('review in the editor with the keyboard: next change, accept all', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'keys');
  const card = await ask(page);
  await card.getByRole('button', { name: 'Review in editor' }).click();
  const bar = page.getByRole('toolbar', { name: 'Review Shawarma\'s change' });
  await expect(bar).toContainText('2 changes left');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
  await page.keyboard.press('ControlOrMeta+Shift+Enter');   // accept all
  await expect(bar).toBeHidden();
  await expect(page.locator('.diffcard').last()).toContainText('Accepted');
  const p = await project(request, id);
  expect(p.code).toContain('sd cp');
  expect(p.code).toContain('hh*16');
});

test('preview plays the proposal without saving anything; Play original is there to compare', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'preview');
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
  const before = await project(request, id);
  const card = await ask(page);
  await expect(card.getByRole('button', { name: 'Play original' })).toBeVisible();
  await card.getByRole('button', { name: '▶ Preview' }).click();
  await expect(card.getByRole('button', { name: '■ Stop preview' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__editor.current.isPlaying() as boolean), { timeout: 15_000 }).toBe(true);
  // nothing was saved and the editor still holds your code
  const after = await project(request, id);
  expect(after.versions).toHaveLength(before.versions.length);
  expect(after.code).toBe(SONG);
  expect(await editorCode(page)).toBe(SONG);
  await card.getByRole('button', { name: '■ Stop preview' }).click();
  await expect(card.getByRole('button', { name: '▶ Preview' })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Accept/ })).toBeEnabled();
});

test('a rejected proposal stays rejected after a reload', async ({ page, request }) => {
  const { id, name } = await openProject(page, request, 'reject');
  const card = await ask(page);
  await card.getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('.diffcard').last()).toContainText('Rejected.');

  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  const reloaded = page.locator('.diffcard').last();
  await expect(reloaded).toContainText('Rejected.', { timeout: 15_000 });
  await expect(reloaded.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  expect(await editorCode(page)).toBe(SONG);
  expect((await project(request, id)).chat.at(-1)).toMatchObject({ role: 'decision', status: 'rejected' });
});

test('an edit to the same line is a conflict for that change only; your unsaved edits get their own version', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'conflict');
  const card = await ask(page);
  // you change the snare line after asking
  await setCode(page, SONG.replace('s("bd sd")', 's("bd bd sd")'));
  const conflict = card.locator('.hunk.conflict');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText('Conflict: you edited these lines too');
  await expect(card.locator('.hunk:not(.conflict)')).toHaveCount(1);
  // the conflict keeps your line unless ticked; the other change still applies
  await card.getByRole('button', { name: 'Accept 1 of 2' }).click();
  await expect(page.locator('.diffcard').last()).toContainText('Accepted 1 of 2 changes.');
  const code = await editorCode(page);
  expect(code).toContain('s("bd bd sd")');
  expect(code).toContain('s("hh*16")');
  expect(code).not.toContain('sd cp');

  const p = await project(request, id);
  expect(p.versions.slice(-2)).toEqual([
    expect.objectContaining({ source: 'manual', message: 'Your edits before Shawarma\'s change' }),
    expect.objectContaining({ source: 'ai' }),
  ]);
});

test('Revert this change takes the change back out and keeps later edits', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'revert');
  const card = await ask(page);
  await card.getByRole('button', { name: 'Accept all 2' }).click();
  const done = page.locator('.diffcard').last();
  await expect(done).toContainText('Accepted.');
  await setCode(page, (await editorCode(page)).replace('note("g3")', 'note("g3 b3")'));
  await done.getByRole('button', { name: 'Revert this change' }).click();
  await expect(done).toContainText('Reverted.');
  const code = await editorCode(page);
  expect(code).toContain('s("bd sd")');
  expect(code).toContain('s("hh*8")');
  expect(code).toContain('note("g3 b3")');
  expect((await project(request, id)).versions.at(-1)).toMatchObject({ source: 'manual', message: expect.stringMatching(/^Reverted: /) });
});

test('a save based on an outdated version is refused with a clear message', async ({ page, request }) => {
  const { id } = await openProject(page, request, 'stale');
  // another tab saves first
  await request.put(`/api/projects/${id}`, { data: { code: 's("cp")' } });
  await setCode(page, SONG.replace('hh*8', 'hh*4'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'another tab' })).toBeVisible();
  expect((await project(request, id)).code).toBe('s("cp")');
});

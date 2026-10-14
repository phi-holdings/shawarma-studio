// Projects: new-project dialog (templates, import), rename, duplicate, delete to trash, strudel.cc
// link, draft recovery and the History tab. Nothing here plays audio.
import { expect, test, type Page } from '@playwright/test';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Projects' });
/** A project's sidebar entry (the row button; "More actions for …" does not start with the name). */
const entry = (page: Page, name: string) => nav(page).getByRole('button', { name, exact: true });
const current = (page: Page) => nav(page).locator('[aria-current="page"]');
const editorCode = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);
const menu = async (page: Page, name: string, item: string) => {
  await nav(page).getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
};
/** strudel.cc's own encoding (code2hash): UTF-8 -> base64 -> encodeURIComponent. */
const strudelLink = (code: string) => `https://strudel.cc/#${encodeURIComponent(Buffer.from(code, 'utf8').toString('base64'))}`;

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  // New, Rename and Delete use in-app dialogs; switching with unsaved edits is the only native one
  page.on('dialog', (d) => { if (d.type() === 'prompt') throw new Error(`unexpected window.prompt: ${d.message()}`); });
}

async function createFromDialog(page: Page, name: string, template?: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByLabel('Project name')).toBeFocused();
  if (template) await dialog.getByText(template, { exact: true }).click();
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await expect(current(page)).toContainText(name);
}

test('New project offers templates; the chosen one becomes the song', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByRole('radio')).toHaveCount(5);
  for (const t of ['Empty beat', 'House groove', 'Ambient pad', 'Maqam groove', 'Breakbeat']) await expect(dialog.getByText(t, { exact: true })).toBeVisible();
  // Escape cancels without creating anything
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const name = `Maqam ${Date.now()}`;
  await createFromDialog(page, name, 'Maqam groove');
  await expect.poll(() => editorCode(page)).toContain('Hijaz on D');
  await expect(page.getByText(`Created ${name}`)).toBeVisible();

  // a taken name is reported inside the dialog, which stays open
  await page.getByRole('button', { name: 'New project' }).click();
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('Import from a strudel.cc link or a file creates a project with that code', async ({ page }) => {
  await open(page);
  const code = '// imported — café 🎶\nnote("d4 eb4 f#4").s("triangle")';
  const name = `Imported ${Date.now()}`;
  const openName = ((await current(page).locator('.project-name').textContent()) ?? '').trim();
  await menu(page, openName, 'Import…');
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true');
  // a short link cannot be read: the dialog says why
  await dialog.getByLabel('strudel.cc link').fill('https://strudel.cc/?J01s5i1J0200');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByRole('alert')).toContainText('short strudel.cc link');
  await dialog.getByLabel('strudel.cc link').fill(strudelLink(code));
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await expect(current(page)).toContainText(name);
  await expect.poll(() => editorCode(page)).toBe(code);

  // a .strudel file: its name becomes the project's name
  const fileName = `beat-${Date.now()}`;
  await page.getByRole('button', { name: 'New project' }).click();
  await dialog.getByRole('tab', { name: 'Import' }).click();
  await dialog.getByLabel('Song file').setInputFiles({ name: `${fileName}.strudel`, mimeType: 'text/plain', buffer: Buffer.from('s("bd*2, hh*4")') });
  await expect(dialog.getByText(`${fileName}.strudel`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await expect(current(page)).toContainText(fileName);
  await expect.poll(() => editorCode(page)).toBe('s("bd*2, hh*4")');
});

test.describe('share link', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
  test('Copy strudel.cc link puts the song, encoded like strudel.cc, on the clipboard', async ({ page, request }) => {
    const created = (await (await request.post('/api/projects', { data: { name: `share-${Date.now()}`, code: 's("bd sd")\n// é' } })).json()) as { name: string };
    await open(page);
    await entry(page, created.name).click();
    await expect.poll(() => editorCode(page)).toBe('s("bd sd")\n// é');
    await menu(page, created.name, 'Copy strudel.cc link');
    await expect(page.getByText(/Copied a strudel\.cc link/)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(strudelLink('s("bd sd")\n// é'));
  });
});

test('Duplicate copies a project; Delete moves it to the trash and opens another', async ({ page, request }) => {
  const name = `Dup ${Date.now()}`;
  const created = (await (await request.post('/api/projects', { data: { name, code: 's("cp*2")' } })).json()) as { id: string };
  await open(page);
  await entry(page, name).click();
  await expect.poll(() => editorCode(page)).toBe('s("cp*2")');

  await menu(page, name, 'Duplicate');
  await expect(page.getByText(`Duplicated as ${name} copy`)).toBeVisible();
  await expect(entry(page, `${name} copy`)).toBeVisible();
  const copy = ((await (await request.get('/api/projects')).json()) as { id: string; name: string }[]).find((p) => p.name === `${name} copy`)!;
  expect(((await (await request.get(`/api/projects/${copy.id}`)).json()) as { code: string }).code).toBe('s("cp*2")');

  // delete asks first; Cancel keeps it
  await menu(page, name, 'Delete…');
  const confirm = page.getByRole('dialog', { name: 'Delete project' });
  await expect(confirm).toContainText('moves to the trash');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(entry(page, name)).toBeVisible();

  await menu(page, name, 'Delete…');
  await confirm.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByText(`Moved ${name} to the trash`)).toBeVisible();
  await expect(entry(page, name)).toHaveCount(0);
  await expect(current(page)).toHaveCount(1);   // another project is open
  expect((await request.get(`/api/projects/${created.id}`)).status()).toBe(404);
  expect(((await (await request.get('/api/projects')).json()) as { id: string }[]).map((p) => p.id)).not.toContain(created.id);
  // the name is free again: a new project of the same name starts fresh
  const again = (await (await request.post('/api/projects', { data: { name, code: 's("hh")' } })).json()) as { id: string };
  expect(again.id).toBe(created.id);
  expect(((await (await request.get(`/api/projects/${again.id}`)).json()) as { code: string }).code).toBe('s("hh")');
});

test('unsaved edits survive a reload and are offered back', async ({ page, request }) => {
  const name = `Draft ${Date.now()}`;
  await request.post('/api/projects', { data: { name, code: 's("bd")' } });
  await open(page);
  await entry(page, name).click();
  await expect.poll(() => editorCode(page)).toBe('s("bd")');
  await setCode(page, 's("bd sd") // not saved');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('shawarma.draft.')))).toBe(true);

  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await entry(page, name).click();
  const banner = page.getByRole('status').filter({ hasText: 'Restore your unsaved edits from' });
  await expect(banner).toBeVisible();
  await expect.poll(() => editorCode(page)).toBe('s("bd")');   // not applied until asked
  await banner.getByRole('button', { name: 'Restore' }).click();
  await expect(banner).toBeHidden();
  await expect.poll(() => editorCode(page)).toBe('s("bd sd") // not saved');

  // saving clears the draft: no offer after the next reload
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await entry(page, name).click();
  await expect.poll(() => editorCode(page)).toBe('s("bd sd") // not saved');
  await expect(page.getByText('Restore your unsaved edits from')).toHaveCount(0);
});

test('History tab: versions with inline diffs; Restore asks before replacing unsaved edits', async ({ page, request }) => {
  const name = `History ${Date.now()}`;
  await request.post('/api/projects', { data: { name, code: 's("bd")' } });
  await open(page);
  await entry(page, name).click();
  await expect.poll(() => editorCode(page)).toBe('s("bd")');
  await setCode(page, 's("bd hh")');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  const versions = page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('Saved');
  await expect(versions.last()).toContainText('Created');
  await versions.first().getByRole('button', { name: 'Show changes' }).click();
  await expect(versions.first().locator('.del')).toContainText('- s("bd")');
  await expect(versions.first().locator('.add')).toContainText('+ s("bd hh")');

  // unsaved edits: Restore asks first; Cancel keeps them
  await setCode(page, 's("cp") // mine');
  await versions.last().getByRole('button', { name: /^Restore/ }).click();
  const ask = page.getByRole('dialog', { name: 'Replace unsaved edits?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(await editorCode(page)).toBe('s("cp") // mine');
  await versions.last().getByRole('button', { name: /^Restore/ }).click();
  await ask.getByRole('button', { name: 'Restore this version' }).click();
  await expect.poll(() => editorCode(page)).toBe('s("bd")');
  await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
});

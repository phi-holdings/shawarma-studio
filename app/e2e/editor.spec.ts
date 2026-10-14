import { expect, test, type Page } from '@playwright/test';

// Editor preferences, find/replace, the Console tab and the Code tab's status bar tools.
// Nothing here plays: evaluation goes through the compile-only `check` request at most.

// wide enough that the status bar shows its tools (they fold into "More tools" in a narrow panel)
test.use({ viewport: { width: 1600, height: 1000 } });

const getCode = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);
const cursorLine = (page: Page) => page.evaluate(() => {
  const e = (window as any).__editor.current;
  return (e.getCode() as string).slice(0, e.getSelection().from).split('\n').length;
});

async function openProject(page: Page, request: import('@playwright/test').APIRequestContext, name: string, code: string) {
  await request.post('/api/projects', { data: { name, code } });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect.poll(() => getCode(page)).toBe(code);
}

async function openEditorSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Editor' }).click();
}

test('line numbers, wrap and theme apply at once and persist after a reload', async ({ page, request }) => {
  await openProject(page, request, 'editor-prefs', 's("bd sd")\n' + `note("${'c e g '.repeat(60)}")`);
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveClass(/cm-lineWrapping/);

  await openEditorSettings(page);
  await page.getByLabel('Line numbers').uncheck();
  await page.getByLabel('Wrap long lines').uncheck();
  await page.getByRole('radio', { name: /Score paper/ }).check();
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await expect(page.locator('.cm-content')).not.toHaveClass(/cm-lineWrapping/);
  await expect(page.locator('.editor')).toHaveAttribute('data-theme', 'paper');
  const bg = await page.locator('.editor').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(250, 250, 249)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');   // the whole app, not just the editor
  expect(await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(240, 240, 238)');
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.editor')).toHaveAttribute('data-theme', 'paper');
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);

  // reset brings the defaults back
  await openEditorSettings(page);
  await page.getByRole('button', { name: 'Reset editor settings' }).click();
  await expect(page.locator('.editor')).toHaveAttribute('data-theme', 'desk');
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(1);
});

test('vim keybindings: normal-mode keys edit the code', async ({ page, request }) => {
  await openProject(page, request, 'editor-vim', 'first line\nsecond line\nthird line');
  await openEditorSettings(page);
  await page.getByLabel('Keybindings').selectOption('vim');
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.locator('.cm-content').getByText('first line').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-fat-cursor')).toHaveCount(1);
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await page.keyboard.type('dd');
  await expect.poll(() => getCode(page)).toBe('second line\nthird line');
  await page.keyboard.type('x');
  await expect.poll(() => getCode(page)).toBe('econd line\nthird line');
  await page.keyboard.type('u');
  await expect.poll(() => getCode(page)).toBe('second line\nthird line');

  // back to the default keymap: typing inserts text again
  await openEditorSettings(page);
  await page.getByLabel('Keybindings').selectOption('default');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.cm-fat-cursor')).toHaveCount(0);
});

test('find and replace all', async ({ page, request }) => {
  await openProject(page, request, 'editor-find', 's("bd sd bd")\nnote("c e").s("piano")');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+f');
  const panel = page.locator('.cm-search');
  await expect(panel).toBeVisible();
  await panel.locator('input[name=search]').fill('bd');
  await panel.locator('input[name=replace]').fill('cp');
  await panel.getByRole('button', { name: 'Replace all' }).click();
  await expect.poll(() => getCode(page)).toBe('s("cp sd cp")\nnote("c e").s("piano")');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('console: an evaluation error links to its line; filters and clear', async ({ page, request }) => {
  await openProject(page, request, 'editor-console', 's("bd sd")');
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
  const bad = 's("bd sd")\n  .gain(0.5\nnote("c e")';
  await setCode(page, bad);
  // compile only (never play): the runtime refuses the code
  const msg = await page.evaluate((c) => (window as any).__runtime.request({ type: 'check', code: c }).then(() => 'ran', (e: Error) => e.message), bad);
  expect(msg).toMatch(/Unexpected token/);

  // the code's check error (with its location) reaches the console; the tab counts it while unread
  const tab = page.getByRole('tab', { name: /Console/ });
  await expect(tab.locator('.tab-count')).toHaveText('1');
  await tab.click();
  await expect(tab.locator('.tab-count')).toHaveCount(0);
  const row = page.locator('.console-row.tone-error', { hasText: 'Unexpected token' }).first();
  await expect(row).toBeVisible();

  // the line link opens the code with the cursor on the bad line
  await row.getByRole('button', { name: /Line 3/ }).click();
  await expect(page.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => cursorLine(page)).toBe(3);

  // filters and clear
  await tab.click();
  await page.getByRole('radio', { name: /Song output/ }).click();
  await expect(page.locator('.console-row.tone-error', { hasText: 'Unexpected token' })).toHaveCount(0);
  await page.getByRole('radio', { name: /Errors/ }).click();
  await expect(page.locator('.console-row', { hasText: 'Unexpected token' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.console-row')).toHaveCount(0);
});

test('visuals menu adds and removes a preset on the layer at the cursor', async ({ page, request }) => {
  const code = 'stack(\n  s("bd sd"),\n  note("c e g").s("piano")\n)';
  await openProject(page, request, 'editor-visuals', code);
  await page.locator('.cm-content').getByText('piano').click();
  const menu = page.getByTestId('visuals-menu');
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: /Piano roll/ }).click();
  await expect.poll(() => getCode(page)).toBe('stack(\n  s("bd sd"),\n  note("c e g").s("piano")._pianoroll()\n)');
  await expect(menu.getByRole('button', { name: /Piano roll/ })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: /Piano roll/ }).click();
  await expect.poll(() => getCode(page)).toBe(code);
});

test('sections menu lists the arrangement and jumps to a section', async ({ page, request }) => {
  const code = 'setcpm(30)\n// == intro ==\nconst intro = s("bd sd")\n// == drop ==\nconst drop = s("bd*4, hh*8")\narrange(\n  [4, intro], // intro\n  [4, drop] // drop\n)';
  await openProject(page, request, 'editor-sections', code);
  const menu = page.getByTestId('sections-menu');
  await expect(menu.locator('summary')).toContainText('2');   // once the section map has arrived
  await menu.locator('summary').click();
  await expect(menu.getByRole('button', { name: 'Play from drop' })).toBeVisible();
  await menu.getByRole('button', { name: /^drop/ }).click();
  await expect.poll(() => cursorLine(page)).toBe(4);   // the "// == drop ==" header

  // tempo readout and nudge edit the setcpm line
  await expect(page.getByTestId('tempo-menu').locator('summary')).toHaveText('30 cpm');
  await page.getByTestId('tempo-menu').locator('summary').click();
  await page.getByRole('button', { name: 'Faster' }).click();
  await expect.poll(async () => (await getCode(page)).split('\n')[0]).toBe('setcpm(31)');
  await expect(page.getByTestId('tempo-menu').locator('summary')).toHaveText('31 cpm');
});

test('a notice from another tab pops up as a toast and is kept in the console', async ({ page, request }) => {
  await openProject(page, request, 'editor-toast', 's("bd sd")');
  await page.getByRole('tab', { name: /Console/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText(/^Saved /);
  await expect(page.locator('.console-row.tone-notice', { hasText: /Saved / })).toBeVisible();
  // back on the Code tab the status line has it, and it is the only copy on the page
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(toast).toHaveCount(0);
  await expect(page.locator('footer.status')).toContainText(/Saved /);
  await expect(page.getByText(/^Saved /)).toHaveCount(1);
});

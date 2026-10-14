import { expect, test, type Locator, type Page } from '@playwright/test';

// a ~200-line song: far taller than the viewport, so only the editor may scroll
const LONG_SONG = ['setcpm(30)', ...Array.from({ length: 199 }, (_, i) => `$: s("bd sd").gain(${(0.5 + (i % 5) / 10).toFixed(1)}) // layer ${i}`)].join('\n');

const inViewport = async (page: Page, el: Locator) => {
  const box = await el.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, 'element is rendered').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
};

const assertFixed = async (page: Page) => {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
  await inViewport(page, page.locator('.app-header'));
  await inViewport(page, page.getByText('Shawarma REPL', { exact: true }));
  await inViewport(page, page.getByRole('button', { name: 'Settings' }));
  await inViewport(page, page.locator('footer.status'));
  await inViewport(page, page.getByRole('heading', { name: 'Chat' }));
  await inViewport(page, page.locator('.composer'));
  await inViewport(page, page.getByRole('button', { name: /Send/ }));
};

for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }]) {
  test.describe(`fixed viewport ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('long song: page never scrolls; header, footer and composer stay visible through a chat reply', async ({ page, request }) => {
      // a project of its own, so the chat starts empty
      const created = (await (await request.post('/api/projects', { data: { name: `layout-${viewport.width}`, code: 's("bd sd")' } })).json()) as { id: string; name: string };
      await page.goto('/');
      await expect(page.locator('.cm-content')).toBeVisible();
      await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${created.name}`) }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__editor.current.getCode() as string)).toBe('s("bd sd")');
      await expect(page.getByText('Ask for a change in your own words.', { exact: false })).toBeVisible();
      await page.evaluate((code) => (window as any).__editor.current.setCode(code), LONG_SONG);
      await expect(page.locator('.cm-content')).toContainText('layer 0');
      await assertFixed(page);

      // the editor scrolls internally
      const scroller = page.locator('.cm-scroller');
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await scroller.hover();
      await page.mouse.wheel(0, 3000);
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await assertFixed(page);

      // a (fake AI) reply lands in the message list, which scrolls by itself
      await page.getByPlaceholder('make the drop heavier…').fill('add a clap');
      await page.getByRole('button', { name: /Send/ }).click();
      await expect(page.locator('.msg.user')).toHaveCount(1);
      await expect(page.locator('.msg.user')).toContainText('You');
      await expect(page.locator('.msg.ai').last()).toContainText('Added a clap after the snare.', { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Send ⌘⏎' })).toBeVisible();
      await assertFixed(page);
    });
  });
}

test('Rename changes the project name shown in the sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  page.on('dialog', () => { throw new Error('New and Rename use in-app dialogs, not window.prompt'); });
  const name = `Rename ${Date.now()}`;
  const nav = page.getByRole('navigation', { name: 'Projects' });
  await page.getByRole('button', { name: 'New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name').fill(name);
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(create).toBeHidden();
  await expect(nav.locator('[aria-current="page"]')).toContainText(name);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename project' });
  await expect(rename.getByLabel('Project name')).toHaveValue(name);
  await rename.getByLabel('Project name').fill(`${name} renamed`);
  await rename.getByLabel('Project name').press('Enter');
  await expect(rename).toBeHidden();
  await expect(nav.locator('[aria-current="page"]')).toContainText(`${name} renamed`);
  await expect(page.getByText(`Renamed to ${name} renamed`)).toBeVisible();
});

test('hovering a control shows a styled tooltip instead of the browser one, with shortcuts as keys', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  const run = page.getByRole('button', { name: '▶ Run all' });
  await run.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText('Play the whole song⌘⏎');
  await expect(tip.locator('kbd')).toHaveText(['⌘', '⏎']);
  await expect(run).not.toHaveAttribute('title');                       // no native tooltip on top of it
  await expect(run).toHaveAttribute('aria-describedby', 'app-tooltip');

  // it sits inside the window, and goes away on leave and on click
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.hover();
  await expect(tip).toHaveText('Save this code as a new version');
  await page.mouse.down();
  await expect(tip).toBeHidden();
  await page.mouse.up();
});

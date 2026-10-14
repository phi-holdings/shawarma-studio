// The runtime's fallback when autoplay is refused inside the sandboxed iframe. Still headless and muted.
import { expect, test, type Page } from '@playwright/test';

// Stricter policy than the default: every start needs a gesture in the frame itself, so the click
// in the parent (delegated via allow="autoplay") is not enough and the in-runtime button takes over.
test.use({ launchOptions: { args: ['--mute-audio', '--site-per-process', '--autoplay-policy=user-gesture-required'] } });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__editor.current.setCode('note("c3 e3").s("sawtooth").gain(0.4)'));
}
const rms = async (page: Page) => Number(await page.getByTestId('level-meter').getAttribute('data-rms'));

test('the runtime asks for a click inside it (a button-sized frame, explained by the app), then plays', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play song' }).first().click();
  const frame = page.locator('iframe.runtime-frame');
  await expect(frame).toHaveClass(/unlock/, { timeout: 5000 });
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  // the frame is exactly the runtime's button; the explanation is the app's own text
  const box = (await frame.boundingBox())!;
  expect([box.width, box.height]).toEqual([220, 36]);
  const button = page.frameLocator('iframe.runtime-frame').getByRole('button', { name: 'Click to enable audio' });
  expect(await button.boundingBox()).toEqual(box);
  await expect(page.locator('.unlock-note')).toBeVisible();
  await expect(page.locator('.unlock-note')).toContainText('The browser blocked audio');
  await button.click();
  await expect(frame).not.toHaveClass(/unlock/);
  await expect(page.locator('.unlock-note')).toBeHidden();
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('the unlock never shows over a modal; it waits until the modal closes and stays below modals', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible();
  // a play started while Settings is open (e.g. Ctrl+Enter in the editor)
  void page.evaluate(() => (window as any).__editor.current.play().catch(() => {}));
  const frame = page.locator('iframe.runtime-frame');
  await page.waitForTimeout(2000);                  // the runtime has asked by now (it gives resume() 1 s)
  await expect(frame).not.toHaveClass(/unlock/);
  await expect(page.locator('.unlock-note')).toBeHidden();
  const z = await page.evaluate(() => {
    const zi = (sel: string) => Number(getComputedStyle(document.querySelector(sel)!).zIndex);
    document.querySelector('iframe.runtime-frame')!.classList.add('unlock');   // measure the unlock styles
    const unlock = zi('iframe.runtime-frame');
    document.querySelector('iframe.runtime-frame')!.classList.remove('unlock');
    return { modal: zi('.modal-backdrop'), unlock, note: Number(getComputedStyle(document.querySelector('.unlock-note')!).zIndex) };
  });
  expect(z.unlock).toBeLessThan(z.modal);
  expect(z.note).toBeLessThan(z.modal);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('.modal-backdrop')).toBeHidden();
  await expect(frame).toHaveClass(/unlock/, { timeout: 2000 });
  await page.frameLocator('iframe.runtime-frame').getByRole('button', { name: 'Click to enable audio' }).click();
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

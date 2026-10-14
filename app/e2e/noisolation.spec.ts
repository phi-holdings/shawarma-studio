// A browser without site isolation (Chromium as Playwright launches it by default, standing in for
// Safari): the song runtime shares the app's thread, so songs run only after the server's pre-flight,
// and the in-runtime guards stop anything that spins later. Headless, muted.
import { expect, test, type Page } from '@playwright/test';

test.use({ launchOptions: { args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'] } });

const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);
const run = (page: Page, code: string) =>
  page.evaluate((c) => (window as any).__runtime.request({ type: 'check', code: c }).then(() => 'ran', (e: Error) => e.message), code);

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__runtime.isolated())).toBe(false);
}

test('without site isolation songs still play, after the pre-flight', async ({ page }) => {
  await open(page);
  await setCode(page, 'note("c3 e3 g3").s("sawtooth").gain(0.4)');
  expect(await run(page, 's("bd")')).toBe('ran');
  await page.locator('.cm-content').click();                       // a user gesture for audio
  expect(await page.evaluate(() => (window as any).__editor.current.play().then(() => 'ok', (e: Error) => e.message))).toBe('ok');
  await page.evaluate(() => (window as any).__editor.current.stop());
});

test('without site isolation a song that hangs is refused and the app stays responsive', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__ticks = 0; setInterval(() => { (window as any).__ticks++; }, 50); });
  const t0 = await page.evaluate(() => (window as any).__ticks);
  const r = await run(page, 'while (true) {} s("bd")');
  expect(r).toMatch(/not run|loop in the song/);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__ticks) - t0).toBeGreaterThan(5);
  expect(await run(page, 's("hh")')).toBe('ran');                // and the next song plays
});

test('without site isolation and without the server check, the song is refused', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__runtime.offlinePrecheck());
  expect(await run(page, 's("bd")')).toMatch(/could not check it first/);
});

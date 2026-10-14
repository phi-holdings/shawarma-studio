// Songs that would never yield, shared by spinners.spec.ts (site isolation on, as desktop Chrome) and
// spinners-noisolation.spec.ts (off, as Safari: only the pre-flight and the guards protect the app).
import { expect, test, type Page } from '@playwright/test';

const SPINNERS = {
  'top level': "while (true) {}\nnote('c3 e3').s('sawtooth')",
  'pattern callback': "note('c3 e3').s('sawtooth').fmap(() => { while (1) {} })",
  'function called per cycle': "const spin = (v) => { let i = 0; for (;;) { i++ } return v }\nnote('c3 e3').s('sawtooth').fmap((v) => spin(v))",
};
// code the transpiled song only builds at runtime, and endless promise chains
const HIDDEN_SPINNERS = {
  eval: "eval('while (true) {}')\nnote('c3').s('sawtooth')",
  'new Function': "note('c3 e3').s('sawtooth').fmap((v) => (Function('while (true) {}')(), v))",
  'string timer': "setTimeout('for (;;) {}', 10)\nnote('c3').s('sawtooth')",
  'promise chain': "const f = () => { Promise.resolve().then(f) }; f()\nnote('c3').s('sawtooth')",
  'await chain': "const g = async () => { await null; return g() }; g()\nnote('c3').s('sawtooth')",
};
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);
const rms = async (page: Page) => Number(await page.getByTestId('level-meter').getAttribute('data-rms'));
const probe = <T,>(page: Page, f: string) => page.evaluate((src) => new Function('p', `return (${src})(p)`)((window as any).__runtime), f) as Promise<T>;

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
}
/** The runtime answers right away (it is not spinning) and was never replaced. */
async function runtimeFine(page: Page, what: string) {
  const t = Date.now();
  expect(await probe(page, `p => p.request({ type: 'check', code: 's("hh")' })`), what).toEqual({ cps: 0.5 });
  expect(Date.now() - t, what).toBeLessThan(2000);
  expect(await probe<number>(page, 'p => p.reloads'), what).toBe(0);
}
async function playsAfterwards(page: Page) {
  await setCode(page, 'note("c3 e3 g3").s("sawtooth").gain(0.4)');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 15_000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
}

export function spinnerTests(isolated: boolean) {
  test('the runtime is ' + (isolated ? '' : 'not ') + 'process-isolated in this browser setup', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).__runtime.isolated())).toBe(isolated);
  });
  test('songs that hang are refused by the pre-flight check before they ever run in the page', async ({ page }) => {
    await open(page);
    for (const [what, code] of Object.entries(SPINNERS)) {
      await setCode(page, code);
      await page.getByRole('button', { name: 'Play song' }).first().click();
      await expect(page.getByText(/This song was not run: .*timed out/), what).toBeVisible({ timeout: 10_000 });
      expect(await probe<boolean>(page, 'p => p.started'), what).toBe(false);
      await runtimeFine(page, what);
    }
    await playsAfterwards(page);
  });

  test('past the pre-flight (a song the check let through), the guards stop every endless loop and chain inside the runtime', async ({ page }) => {
    await open(page);
    await probe(page, 'p => p.withoutPrecheck()');
    for (const [what, code] of Object.entries({ ...SPINNERS, ...HIDDEN_SPINNERS })) {
      await probe(page, 'p => { p.errors.length = 0 }');
      await setCode(page, code);
      await page.getByRole('button', { name: 'Play song' }).first().click();
      await expect.poll(async () => {
        const errors = await probe<string[]>(page, 'p => p.errors');
        const footer = await page.locator('footer.status').innerText();
        return errors.join('\n') + footer;
      }, { timeout: 5000, message: what }).toMatch(/ran for more than 500 ms and was stopped|promise callbacks without pausing/);
      await expect.poll(() => probe<boolean>(page, 'p => p.started'), { timeout: 3000 }).toBe(false);
      await runtimeFine(page, what);
    }
    await playsAfterwards(page);
  });
}

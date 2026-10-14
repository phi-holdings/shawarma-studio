// The production build served by the API server (`pnpm build && pnpm start`): the app and the
// sandboxed song runtime load from the server alone and play. Headless and muted like every spec.
import { expect, test } from '@playwright/test';
import { prodPort } from './env';

const base = `http://localhost:${prodPort}`;

test('the server-served build loads the runtime and plays', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/`);
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  // the runtime frame is the built runtime.html, still sandboxed
  const frame = page.locator('iframe.runtime-frame');
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  // a synth (no sample download): replace the buffer through the editor itself
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('note("c3 e3 g3 c4").s("sawtooth").gain(0.5)');
  await expect(content).toContainText('sawtooth');
  const rms = async () => Number(await page.getByTestId('level-meter').getAttribute('data-rms'));
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(rms, { timeout: 30_000, intervals: [100] }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  await expect.poll(rms, { timeout: 5000 }).toBeLessThan(1e-4);
  expect(failed).toEqual([]);
});

test('the server-served build refuses null-origin requests that are not the runtime loading scripts', async ({ page, request }) => {
  await page.goto(`${base}/`);
  const html = await (await request.get(`${base}/runtime.html`)).text();
  const entry = /import "(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeTruthy();
  const h = { origin: 'null', 'sec-fetch-dest': 'script' };
  expect((await request.get(`${base}${entry}`, { headers: { ...h, referer: 'https://evil.example/' } })).status()).toBe(403);
  expect((await request.get(`${base}${entry}`, { headers: { ...h, referer: `${base}/`, 'sec-fetch-dest': 'empty' } })).status()).toBe(403);
  const ok = await request.get(`${base}${entry}`, { headers: { ...h, referer: `${base}/` } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['access-control-allow-origin']).toBe('null');
  expect((await request.get(`${base}/api/projects`, { headers: { origin: 'null' } })).status()).toBe(403);
  expect((await request.get(`${base}/api/projects`, { headers: { origin: base } })).status()).toBe(200);
  // production: the Vite dev port is not an allowed origin
  expect((await request.get(`${base}/api/projects`, { headers: { origin: 'http://localhost:5173' } })).status()).toBe(403);
});

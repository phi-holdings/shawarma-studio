// Hosted production build, served by the hosted server itself: its security headers (CSP for the app
// and for the song runtime, Permissions-Policy, Referrer-Policy) break nothing, and the sound packs come
// from the self-hosted packs URL only, never from Strudel's CDN or GitHub. Headless and muted.
import { expect, test } from '@playwright/test';
import { oidcPort, packsPort, prodPort, prodUrl } from './env';

test.use({ baseURL: prodUrl });

/** Origins the hosted app may talk to here: itself (both loopback names), the packs, the fake Google. */
const allowed = new Set([`http://localhost:${prodPort}`, `http://127.0.0.1:${prodPort}`, `http://127.0.0.1:${packsPort}`, `http://127.0.0.1:${oidcPort}`]);

test('the production build plays samples and soundfonts under its CSP, from the self-hosted packs only', async ({ page }) => {
  const violations: string[] = [];
  const foreign = new Set<string>();
  // in every frame, the sandboxed song runtime included
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI} on ${location.href}`));
  });
  // Chrome reports some blocks (worklet modules) only as a failed load, not as a violation event
  page.on('console', (m) => { if (/CSP violation|Content Security Policy|Refused to|Failed to load worklet|could not load AudioWorklet/.test(m.text())) violations.push(m.text().slice(0, 300)); });
  page.on('request', (r) => { const o = new URL(r.url()).origin; if (o.startsWith('http') && !allowed.has(o)) foreign.add(o); });

  const landing = await page.goto('/');
  const csp = landing!.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  expect(landing!.headers()['permissions-policy']).toContain('camera=()');
  expect(landing!.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Write songs in code');

  await page.getByRole('link', { name: /Continue with Google/ }).first().click();
  await page.getByRole('textbox', { name: 'Email' }).fill(`csp-${Date.now()}@example.com`);
  await page.getByRole('textbox', { name: 'Name' }).fill('CSP Tester');
  await page.getByRole('button', { name: 'Sign in as this person' }).click();
  await expect(page.getByRole('button', { name: /^Account: CSP Tester, Free plan$/ })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill('CSP song');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();

  // the runtime frame: sandboxed, told where the packs are, with its own policy
  const frame = page.locator('iframe.runtime-frame');
  await expect(frame).toHaveAttribute('src', new RegExp(`[?&]s=${encodeURIComponent(`http://127.0.0.1:${packsPort}/packs`)}(&|$)`));
  const runtime = await page.request.get(`${prodUrl}/runtime.html`);
  expect(runtime.headers()['content-security-policy']).toContain("'unsafe-eval'");
  expect(runtime.headers()['content-security-policy']).not.toMatch(/b-cdn|github/);

  // samples (uzu-drumkit, piano) and a GM soundfont, all through the packs URL
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('stack(s("bd*4"), note("c3 e3").s("piano"), note("g3").s("gm_epiano1"))');
  await expect(content).toContainText('gm_epiano1');
  const rms = async () => Number(await page.getByTestId('level-meter').getAttribute('data-rms'));
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(rms, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();

  // the sound browser lists the hosted packs (maps from the packs URL)
  await page.getByRole('tab', { name: 'Sounds' }).click();
  await expect(page.getByText('Loading sounds from the song runtime…')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Play bd', exact: true }).first()).toBeVisible();

  expect(violations).toEqual([]);
  expect([...foreign]).toEqual([]);
});

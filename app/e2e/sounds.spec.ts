import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { projectDir } from './env';

// The sound browser. Never clicks a Play (audition) control: automated browsers must stay silent, so
// the tests only check that those controls are there.

/** A tiny valid 16-bit mono PCM WAV (silence). */
function tinyWav(frames = 64): Buffer {
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  return b;
}

const code = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);

async function openSounds(page: Page, request: import('@playwright/test').APIRequestContext, name: string, song: string) {
  await request.post('/api/projects', { data: { name, code: song } });
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect.poll(() => code(page)).toBe(song);
  await page.getByRole('tab', { name: 'Sounds' }).click();
  const list = page.getByRole('listbox', { name: 'Sounds' });
  await expect(list).toBeVisible();
  // the built-in sounds arrive from the song runtime once it has loaded its sample maps
  await expect(page.getByText('Loading sounds from the song runtime…')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Play bd', exact: true }).first()).toBeVisible();
  return list;
}

test('search, filter and add sounds from the browser to the chat', async ({ page, request }) => {
  await openSounds(page, request, 'sounds-browse', 's("bd sd")');

  // the song uses bd and sd: they are listed first
  await expect(page.getByRole('button', { name: /Used in this song/ })).toBeVisible();

  // type chips filter the list; a synth has an audition control and inserts with a note
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('sawtooth');
  await page.getByRole('group', { name: 'Sound type' }).getByRole('button', { name: /^Synths/ }).click();
  await expect(page.getByRole('group', { name: 'Sound type' }).getByRole('button', { name: /^Synths/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Drum machines/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play sawtooth' })).toBeVisible();   // exists; never clicked
  const message = page.getByRole('textbox', { name: 'Message Shawarma' });
  await page.getByRole('button', { name: 'Add sawtooth to chat' }).click();
  await expect(message).toHaveValue('Add `note("c3").s("sawtooth")`');
  await expect(page.getByRole('status').filter({ hasText: 'Added note("c3").s("sawtooth") to your message' })).toBeVisible();
  expect(await code(page)).not.toContain('sawtooth');   // the song is untouched: Claude makes the change

  // drum machines: pads grouped by bank; inserting a pad adds its bank
  await page.getByRole('button', { name: /^Drums/ }).click();
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('tr808');
  await expect(page.getByText('RolandTR808', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play bd (RolandTR808)' })).toBeVisible(); // exists; never clicked
  await page.getByRole('button', { name: 'Add bd from RolandTR808 to chat' }).click();
  await expect(message).toHaveValue('Add `note("c3").s("sawtooth")` and `s("bd").bank("RolandTR808")`');

  // keyboard: from the search box into the list, Cmd/Ctrl+Enter inserts the active sound (Enter alone would play it)
  await page.getByRole('button', { name: /^Instruments/ }).click();
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('gm_piano');
  await page.getByRole('searchbox', { name: 'Search sounds' }).press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Sounds' })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(message).toHaveValue(/and `note\("c3"\)\.s\("gm_piano"\)`$/);

  // nothing matches: an empty state that offers a way out
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('zzqqxx');
  await expect(page.getByText('No sounds match “zzqqxx”.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search sounds' })).toHaveValue('');
});

test("upload a wav into the project's samples and see it listed", async ({ page, request }) => {
  await openSounds(page, request, 'sounds-upload', 's("bd")');
  await page.getByRole('button', { name: /^Samples/ }).click();
  await expect(page.getByRole('button', { name: /This project's samples/ })).toBeVisible();
  await expect(page.getByText('Drop audio files here')).toBeVisible();

  await page.getByLabel('Add audio files').setInputFiles([
    { name: 'E2E Kick.wav', mimeType: 'audio/wav', buffer: tinyWav() },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') },
  ]);
  await expect(page.getByRole('button', { name: 'Add e2e_kick to chat' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play e2e_kick' })).toBeVisible();   // exists; never clicked
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 file' })).toContainText('Skipped 1 file');
  // the song runtime loaded it (no "can't use them yet" error) and the file is on disk with its map
  await expect(page.getByText(/can't use them yet/)).toHaveCount(0);
  const dir = path.join(await projectDir(request, 'sounds-upload'), 'samples');
  expect(fs.readdirSync(path.join(dir, 'e2e_kick'))).toEqual(['e2e-kick.wav']);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'strudel.json'), 'utf8'))).toEqual({ e2e_kick: ['e2e_kick/e2e-kick.wav'] });
  await expect.poll(() => page.evaluate(async () =>
    ((await (window as any).__runtime.request({ type: 'listSounds' })) as { name: string }[]).some((s) => s.name === 'e2e_kick'))).toBe(true);

  await page.getByRole('button', { name: 'Add e2e_kick to chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Shawarma' })).toHaveValue('Add `s("e2e_kick")`');
});

test('the sounds can sit under the code, and go back to their tab', async ({ page, request }) => {
  await openSounds(page, request, 'sounds-split', 's("bd")');
  await page.getByRole('tab', { name: 'Code' }).click();
  const toggle = page.getByRole('button', { name: 'Sounds below' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Sounds' })).toHaveCount(0);       // shown under the code instead
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search sounds' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the sounds under the code' })).toBeVisible();

  // still there after a reload, and picking a sound still goes to the chat
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sounds below' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: 'Search sounds' }).fill('sawtooth');
  await page.getByRole('button', { name: 'Add sawtooth to chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Shawarma' })).toHaveValue('Add `note("c3").s("sawtooth")`');

  await page.getByRole('button', { name: 'Sounds below' }).click();
  await expect(page.getByRole('tab', { name: 'Sounds' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search sounds' })).toBeHidden();
});

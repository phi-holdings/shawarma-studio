// Exports: range/section export and the Exports tab. Rendering is offline (no sound); the tab's
// <audio> players are only checked, never played.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { exportsDir } from './env';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const openProject = async (page: Page, name: string) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${escape(name)}`) }).click();
};
const editorCode = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);

/** A 24-bit stereo 48 kHz WAV of silence lasting `sec` seconds. */
function wav(sec: number): Buffer {
  const bytes = Math.round(sec * 48000) * 6;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * 6, 28); b.writeUInt16LE(6, 32); b.writeUInt16LE(24, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}

test('Exports tab lists past exports newest first, with players, sizes and delete', async ({ page, request }) => {
  const name = `Exports ${Date.now()}`;
  const { id } = (await (await request.post('/api/projects', { data: { name, code: 's("bd")' } })).json()) as { id: string };
  const dir = await exportsDir(request, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.wav`), wav(3));
  fs.writeFileSync(path.join(dir, `${id}.mp3`), Buffer.alloc(2048));
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(dir, `${id}.wav`), old, old);
  fs.utimesSync(path.join(dir, `${id}.mp3`), old, old);
  fs.writeFileSync(path.join(dir, `${id}-section-1-intro.wav`), wav(1));
  fs.writeFileSync(path.join(dir, `${id}-section-1-intro.mp3`), Buffer.alloc(1024));

  await openProject(page, name);
  await page.getByRole('tab', { name: 'Exports' }).click();
  const items = page.getByRole('list', { name: 'Past exports' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText(`${id}-section-1-intro`);
  await expect(items.first()).toContainText('0:01');
  await expect(items.last()).toContainText('0:03');
  await expect(items.last()).toContainText('WAV');
  await expect(items.last()).toContainText('MP3 · 2 KB');

  // the player is a plain <audio> pointing at the server; nothing loads or plays on its own
  const audio = items.last().locator('audio');
  await expect(audio).toHaveAttribute('src', `/api/projects/${encodeURIComponent(id)}/export-files/${encodeURIComponent(`${id}.mp3`)}`);
  await expect(audio).toHaveAttribute('preload', 'none');
  expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  const served = await request.get(`/api/projects/${id}/export-files/${id}.mp3`, { headers: { range: 'bytes=0-9' } });
  expect(served.status()).toBe(206);
  expect(served.headers()['content-type']).toBe('audio/mpeg');

  await items.first().getByRole('button', { name: `Delete ${id}-section-1-intro` }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete export' });
  await confirm.getByRole('button', { name: 'Delete export' }).click();
  await expect(items).toHaveCount(1);
  expect(fs.readdirSync(dir).filter((f) => f.includes('section-1-intro'))).toEqual([]);
});

test('an empty Exports tab invites an export', async ({ page, request }) => {
  const name = `No exports ${Date.now()}`;
  await request.post('/api/projects', { data: { name, code: 's("bd")' } });
  await openProject(page, name);
  await page.getByRole('tab', { name: 'Exports' }).click();
  await expect(page.getByText('No exports yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export the song' })).toBeVisible();
});

test('export options: a bad cycle range is explained; a section exports only that section', async ({ page, request }) => {
  const name = `Range ${Date.now()}`;
  const code = 'setcpm(60)\narrange(\n  [2, s("bd*2")], // intro\n  [3, s("hh*4")], // groove\n)';
  const { id } = (await (await request.post('/api/projects', { data: { name, code } })).json()) as { id: string };
  await openProject(page, name);
  await expect.poll(() => editorCode(page)).toBe(code);
  await expect(page.locator('.cm-section-widget.cm-sw-entry')).toHaveCount(2);

  await page.getByLabel('Export options').click();
  await page.getByRole('radio', { name: 'Cycles' }).check();
  await page.getByLabel('Start cycle').fill('4');
  await page.getByLabel('End cycle').fill('2');
  await expect(page.locator('.export-range').getByRole('alert')).toHaveText('The end cycle must be after the start cycle.');
  await page.getByLabel('End cycle').fill('9');
  await expect(page.locator('.export-range').getByRole('alert')).toContainText('5 cycles long');

  await page.getByRole('radio', { name: 'Section' }).check();
  await page.getByLabel('Which section').selectOption({ label: '2. groove (3 cycles)' });
  await expect(page.locator('.export-range')).toContainText('0:03 · cycles 2–5');
  await page.getByLabel('Export options').click();   // close the popover
  await page.getByRole('button', { name: '⤓ Export' }).click();
  await expect(page.getByText(/Exported groove: .*\.wav/)).toBeVisible({ timeout: 90_000 });

  const file = path.join(await exportsDir(request, id), `${id}-section-2-groove.wav`);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  expect(seconds).toBeCloseTo(3, 1);
  await page.getByRole('tab', { name: 'Exports' }).click();
  await expect(page.getByRole('list', { name: 'Past exports' })).toContainText(`${id}-section-2-groove`);
});

// Renders the committed brand images into app/public with headless Chromium (@playwright/test):
//   og.png (1200x630 social image, from scripts/brand/og.html), favicon-32.png, apple-touch-icon.png (180),
//   icon-192.png, icon-512.png, icon-maskable-512.png (all from public/favicon.svg).
// Run after changing the favicon or the social image design, then commit the PNGs:
//   node scripts/brand-assets.mjs        (from app/)
// The images have no URLs in them, so they do not depend on PUBLIC_URL.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(appDir, 'public');
const require = createRequire(path.join(appDir, 'package.json'));
const dataUrl = async (file, type) => `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;

const favicon = await dataUrl(path.join(pub, 'favicon.svg'), 'image/svg+xml');
// the large icons use the fine-line drawing (public/icon.svg); the favicon's heavier lines are for 16-32 px
const large = await dataUrl(path.join(pub, 'icon.svg'), 'image/svg+xml');
const geist = await dataUrl(require.resolve('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'), 'font/woff2');
const geistMono = await dataUrl(require.resolve('@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2'), 'font/woff2');
/** The favicon tile colour: square icons fill their corners with it (iOS and maskable icons are cropped by the OS). */
const TILE = '#fafaf9';

// never audible: headless, output muted (nothing here plays sound anyway)
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const html = (await fs.readFile(path.join(appDir, 'scripts/brand/og.html'), 'utf8'))
    .replace('__GEIST__', geist).replace('__GEIST_MONO__', geistMono).replaceAll('__ICON__', large);
  await og.setContent(html, { waitUntil: 'load' });
  await og.evaluate(() => document.fonts.ready);
  const missing = await og.evaluate(() => ['Geist'].filter((f) => !document.fonts.check(`16px "${f}"`)));
  if (missing.length) throw new Error(`fonts did not load: ${missing.join(', ')}`);
  await og.screenshot({ path: path.join(pub, 'og.png'), type: 'png' });

  /** size: output px; inset: icon size as a share of the canvas; tile: fill the square behind it. */
  const icon = async (file, size, { inset = 1, tile = false, src = large } = {}) => {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const px = Math.round(size * inset);
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;
      background:${tile ? TILE : 'transparent'};display:grid;place-items:center}img{width:${px}px;height:${px}px;display:block}</style>
      <img src="${src}" alt="">`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(pub, file), type: 'png', omitBackground: !tile });
    await page.close();
  };
  await icon('favicon-32.png', 32, { src: favicon });
  await icon('apple-touch-icon.png', 180, { tile: true });
  await icon('icon-192.png', 192);
  await icon('icon-512.png', 512);
  // maskable: the safe zone is the centre 80%, so the spit sits inside it on a full-bleed tile
  await icon('icon-maskable-512.png', 512, { inset: 0.8, tile: true });
} finally {
  await browser.close();
}
console.log('wrote og.png, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png to app/public');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { robotsTxt, sitemapXml } from './crawl';
import { renderPage } from './render';
import { normalizePublicUrl, PUBLIC_ROUTES } from './routes';
import { signInErrorMessage } from './signInError';

const template = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site/index.html'), 'utf8');
const BASE = 'https://shawarma.example';
const head = (html: string) => html.slice(0, html.indexOf('</head>'));
const attr = (html: string, re: RegExp) => html.match(re)?.[1];

describe.each(PUBLIC_ROUTES)('prerendered $path', (route) => {
  const html = renderPage(template, route, BASE, { fontHref: '/assets/geist-latin-wght-normal-x.woff2' });
  const h = head(html);
  const url = route.path === '/' ? `${BASE}/` : `${BASE}${route.path}`;

  test('head: title, description, canonical, lang, viewport, theme colour', () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en"/);
    expect(h).toContain(`<title>${route.title}</title>`);
    expect(attr(h, /<meta name="description" content="([^"]+)"/)).toBe(route.description);
    expect(attr(h, /<link rel="canonical" href="([^"]+)"/)).toBe(url);
    expect(h).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(h).toContain('<meta name="theme-color" content="#fafaf9" />');
    expect(h).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(h).not.toContain('noindex');
    expect(h).toContain('<link rel="preload" href="/assets/geist-latin-wght-normal-x.woff2" as="font" type="font/woff2" crossorigin />');
  });

  test('head: Open Graph and Twitter card', () => {
    const og = (p: string) => attr(h, new RegExp(`<meta property="og:${p}" content="([^"]+)"`));
    const tw = (p: string) => attr(h, new RegExp(`<meta name="twitter:${p}" content="([^"]+)"`));
    expect(og('title')).toBe(route.title);
    expect(og('description')).toBe(route.description);
    expect(og('url')).toBe(url);
    expect(og('image')).toBe(`${BASE}/og.png`);
    expect(og('type')).toBe('website');
    expect(og('site_name')).toBe('Shawarma REPL');
    expect(tw('card')).toBe('summary_large_image');
    expect(tw('image')).toBe(`${BASE}/og.png`);
  });

  test('body: the page content, no app bundle, slots filled', () => {
    expect(html).not.toContain('<!--seo-');
    expect(html).toMatch(/<div id="root"><div class="landing[ "]/);
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).not.toMatch(/main\.tsx|codemirror|strudel\//i);
    expect(html).toContain('<a href="/privacy">Privacy</a>');
  });
});

test('JSON-LD on the landing page only: the app (free tier, no paid price) and phi holdings', () => {
  const [landing, ...docs] = PUBLIC_ROUTES.map((r) => renderPage(template, r, BASE));
  for (const d of docs) expect(d).not.toContain('application/ld+json');
  const json = landing.match(/<script type="application\/ld\+json">(.+?)<\/script>/)?.[1];
  const graph = JSON.parse(json!)['@graph'];
  const appLd = graph.find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication');
  const org = graph.find((n: { '@type': string }) => n['@type'] === 'Organization');
  expect(appLd).toMatchObject({ name: 'Shawarma REPL', applicationCategory: 'MusicApplication', operatingSystem: 'Web', url: `${BASE}/` });
  expect(appLd.description).toBeTruthy();
  expect(appLd.offers).toMatchObject({ '@type': 'Offer', price: '0' });
  expect(Array.isArray(appLd.offers)).toBe(false);
  expect(org).toMatchObject({ name: 'phi holdings', url: 'https://phi.holdings' });
  expect(landing).toContain('href="/auth/google"');
});

test('robots.txt allows exactly the public pages and disallows the rest', () => {
  const lines = robotsTxt(BASE).split('\n');
  const pageAllows = lines.filter((l) => /^Allow: .*\$$/.test(l)).map((l) => l.slice('Allow: '.length, -1));
  expect(pageAllows).toEqual(PUBLIC_ROUTES.map((r) => r.path));
  expect(lines.filter((l) => l.startsWith('Allow: ') && !l.endsWith('$')).every((l) => !/^Allow: \/(api|auth|app)\b/.test(l))).toBe(true);
  for (const d of ['/api/', '/auth/', '/app', '/']) expect(lines).toContain(`Disallow: ${d}`);
  expect(lines).toContain(`Sitemap: ${BASE}/sitemap.xml`);
});

test('sitemap.xml lists exactly the public pages with lastmod', () => {
  const lastmods = Object.fromEntries(PUBLIC_ROUTES.map((r) => [r.path, '2026-10-13']));
  const xml = sitemapXml(BASE, lastmods);
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([`${BASE}/`, `${BASE}/privacy`, `${BASE}/terms`, `${BASE}/source`]);
  expect([...xml.matchAll(/<lastmod>2026-10-13<\/lastmod>/g)]).toHaveLength(PUBLIC_ROUTES.length);
  expect(() => sitemapXml(BASE, {})).toThrow(/lastmod/);
});

test('PUBLIC_URL: defaults to the local server, trailing slashes dropped, junk refused', () => {
  expect(normalizePublicUrl(undefined)).toBe('http://localhost:8787');
  expect(normalizePublicUrl(' https://shawarma.example/ ')).toBe('https://shawarma.example');
  expect(() => normalizePublicUrl('shawarma.example')).toThrow(/PUBLIC_URL/);
  expect(() => normalizePublicUrl('ftp://x.example')).toThrow(/PUBLIC_URL/);
});

test('sign-in errors: fixed sentences, never text from the URL', () => {
  expect(signInErrorMessage(null)).toBeNull();
  expect(signInErrorMessage('access_denied')).toMatch(/cancelled/);
  expect(signInErrorMessage('<script>you won a prize</script>')).toBe('Sign-in did not finish. Continue with Google to try again.');
  expect(signInErrorMessage('toString')).toBe('Sign-in did not finish. Continue with Google to try again.');
});

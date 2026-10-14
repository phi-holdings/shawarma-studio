// robots.txt and sitemap.xml, generated at build from PUBLIC_ROUTES.
import { escapeHtml } from './head';
import { absoluteUrl, PUBLIC_ROUTES, type PublicRoute } from './routes';

/** Files the public pages need to render (crawlers fetch CSS, fonts and images to render a page). */
export const PUBLIC_ASSET_ALLOWS = [
  '/assets/', '/og.png', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/icon-maskable-512.png', '/manifest.webmanifest',
];

/**
 * Allow the public pages (exact paths, `$`-anchored) and their assets; disallow everything else,
 * naming the API, sign-in and app paths explicitly for crawlers that ignore `Allow`.
 */
export function robotsTxt(publicUrl: string, routes: readonly PublicRoute[] = PUBLIC_ROUTES): string {
  return [
    '# Shawarma REPL: only the public pages are for crawlers; the signed-in app is not.',
    'User-agent: *',
    ...routes.map((r) => `Allow: ${r.path}$`),
    ...PUBLIC_ASSET_ALLOWS.map((p) => `Allow: ${p}`),
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /app',
    'Disallow: /',
    '',
    `Sitemap: ${absoluteUrl(publicUrl, '/sitemap.xml')}`,
    '',
  ].join('\n');
}

/** lastmod per route path, as YYYY-MM-DD. */
export type Lastmods = Record<string, string>;

export function sitemapXml(publicUrl: string, lastmods: Lastmods, routes: readonly PublicRoute[] = PUBLIC_ROUTES): string {
  const urls = routes.map((r) => {
    const lastmod = lastmods[r.path];
    if (!lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) throw new Error(`sitemap: no lastmod (YYYY-MM-DD) for ${r.path}`);
    return `  <url>\n    <loc>${escapeHtml(absoluteUrl(publicUrl, r.path))}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

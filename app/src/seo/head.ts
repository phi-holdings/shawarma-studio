// The per-page <head> tags of the prerendered public pages: title, description, canonical, Open Graph,
// Twitter card, the font preload and (landing only) JSON-LD. Pure strings, so tests can read them.
import { absoluteUrl, OG_IMAGE, SITE_NAME, type PublicRoute } from './routes';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const meta = (attr: 'name' | 'property', key: string, content: string) =>
  `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;

/** schema.org data for the landing page: the app (free to start, no paid price yet) and who makes it. */
export function landingJsonLd(publicUrl: string, description: string): object {
  const home = absoluteUrl(publicUrl, '/');
  const org = { '@type': 'Organization', '@id': 'https://phi.holdings/#organization', name: 'phi holdings', url: 'https://phi.holdings' };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      {
        '@type': 'SoftwareApplication',
        '@id': `${home}#app`,
        name: SITE_NAME,
        url: home,
        description,
        applicationCategory: 'MusicApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern browser with JavaScript and Web Audio.',
        image: absoluteUrl(publicUrl, OG_IMAGE.path),
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        // only the free tier has a price; paid plans are left out until pricing is set
        offers: { '@type': 'Offer', name: 'Free', description: 'The editor, sounds and export', price: '0', priceCurrency: 'USD', url: home },
        publisher: { '@id': org['@id'] },
      },
    ],
  };
}

/** JSON for a <script> element: no "</script>" or "<!--" can end it early. */
export const scriptJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export interface HeadOptions {
  /** Built URL of the Geist latin woff2 to preload (dist/assets/...), when known. */
  fontHref?: string;
}

export function headTags(route: PublicRoute, publicUrl: string, opts: HeadOptions = {}): string {
  const url = absoluteUrl(publicUrl, route.path);
  const image = absoluteUrl(publicUrl, OG_IMAGE.path);
  const tags = [
    `<title>${escapeHtml(route.title)}</title>`,
    meta('name', 'description', route.description),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    opts.fontHref && `<link rel="preload" href="${escapeHtml(opts.fontHref)}" as="font" type="font/woff2" crossorigin />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', route.title),
    meta('property', 'og:description', route.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', String(OG_IMAGE.width)),
    meta('property', 'og:image:height', String(OG_IMAGE.height)),
    meta('property', 'og:image:alt', OG_IMAGE.alt),
    meta('property', 'og:locale', 'en_US'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', route.title),
    meta('name', 'twitter:description', route.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', OG_IMAGE.alt),
    route.page === 'landing' &&
      `<script type="application/ld+json">${scriptJson(landingJsonLd(publicUrl, route.description))}</script>`,
  ];
  return tags.filter(Boolean).join('\n    ');
}

// The public (signed-out, indexable) pages of hosted Shawarma: the one list that the prerender, the
// sitemap, robots.txt, the preview server and the tests all read. The server keeps the same paths in
// server/src/http/appStatic.ts (PUBLIC_PAGES); a test there pins them to this list.

export type PublicPage = 'landing' | 'pricing' | 'privacy' | 'terms' | 'source';

export interface PublicRoute {
  /** URL path, no trailing slash except the root. */
  path: string;
  page: PublicPage;
  /** Where the prerendered HTML goes, relative to app/dist. */
  file: string;
  title: string;
  description: string;
  /** Source files whose last commit date is the page's sitemap lastmod (relative to app/). */
  sources: string[];
}

const shared = ['src/landing/landing.css', 'src/landing/contact.ts', 'src/landing/proPrices.ts'];
const doc = ['src/landing/DocPage.tsx', ...shared];

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: '/',
    page: 'landing',
    file: 'site/index.html',
    title: 'Shawarma REPL: write songs in code, change them by asking',
    description:
      'Live-code music with Strudel. Your song loops while you type; ask Shawarma, the assistant, for a change in plain words and hear it before you keep it. Free editor; the assistant comes with Pro, 7 days free.',
    sources: ['src/landing/Landing.tsx', 'src/landing/figures.ts', ...shared],
  },
  {
    path: '/pricing',
    page: 'pricing',
    file: 'site/pricing/index.html',
    title: 'Pricing · Shawarma REPL',
    description:
      'Shawarma REPL pricing: the editor, sounds and export are free. Pro adds the AI assistant for $12 a month or $120 a year, with a 7-day free trial.',
    sources: ['src/landing/Pricing.tsx', ...doc],
  },
  {
    path: '/privacy',
    page: 'privacy',
    file: 'site/privacy/index.html',
    title: 'Privacy · Shawarma REPL',
    description:
      'What Shawarma REPL keeps about you, why, who else sees it, how long it is kept, and how to export or delete it yourself.',
    sources: ['src/landing/Privacy.tsx', ...doc],
  },
  {
    path: '/terms',
    page: 'terms',
    file: 'site/terms/index.html',
    title: 'Terms · Shawarma REPL',
    description:
      'The rules for using Shawarma REPL: who runs it, your songs are yours, payments and refunds, acceptable use, AI output and the limits of the service.',
    sources: ['src/landing/Terms.tsx', ...doc],
  },
  {
    path: '/source',
    page: 'source',
    file: 'site/source/index.html',
    title: 'Source code · Shawarma REPL',
    description:
      'The Shawarma REPL editor is free software under the AGPL-3.0, built on Strudel. How to get the complete source code of the version we run, at no charge.',
    sources: ['src/landing/Source.tsx', ...doc],
  },
];

export const SITE_NAME = 'Shawarma REPL';
/** The public site's paper (landing.css): theme-color, manifest colours and the social image background. */
export const THEME_COLOR = '#fafaf9';
export const DEFAULT_PUBLIC_URL = 'http://localhost:8787';
/** Where "Continue with Google" goes on the prerendered landing page (part 5's route). */
export const SIGN_IN_HREF = '/auth/google';
export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630, alt: 'Shawarma REPL: write songs in code, change them by asking.' };

/** PUBLIC_URL as an origin (plus optional base path) without a trailing slash; throws on a bad value. */
export function normalizePublicUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_PUBLIC_URL;
  let u: URL;
  try { u = new URL(value); } catch { throw new Error(`PUBLIC_URL is not a URL: "${value}". Set it to the site's address, e.g. https://shawarma.example`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`PUBLIC_URL must start with https:// (got "${value}")`);
  if (u.search || u.hash) throw new Error(`PUBLIC_URL must not have a query or fragment (got "${value}")`);
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/** The absolute URL of a site path under the normalised PUBLIC_URL. */
export function absoluteUrl(publicUrl: string, path: string): string {
  return path === '/' ? `${publicUrl}/` : `${publicUrl}${path}`;
}

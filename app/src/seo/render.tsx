// Renders the public pages to static HTML at build time (scripts/prerender.mjs loads this through Vite).
// The pages need no JavaScript: links are plain anchors and the sign-in button goes to the server.
import { renderToString } from 'react-dom/server';
import { defaultLinks } from '../landing/contact';
import { Landing } from '../landing/Landing';
import { Pricing } from '../landing/Pricing';
import { Privacy } from '../landing/Privacy';
import { Source } from '../landing/Source';
import { Terms } from '../landing/Terms';
import { headTags, type HeadOptions } from './head';
import { PUBLIC_ROUTES, SIGN_IN_HREF, type PublicPage, type PublicRoute } from './routes';

export { PUBLIC_ROUTES, normalizePublicUrl } from './routes';
export { robotsTxt, sitemapXml } from './crawl';

export function renderBody(page: PublicPage): string {
  switch (page) {
    case 'landing': return renderToString(<Landing signInHref={SIGN_IN_HREF} links={defaultLinks} />);
    case 'pricing': return renderToString(<Pricing signInHref={SIGN_IN_HREF} links={defaultLinks} />);
    case 'privacy': return renderToString(<Privacy links={defaultLinks} />);
    case 'terms': return renderToString(<Terms links={defaultLinks} />);
    case 'source': return renderToString(<Source links={defaultLinks} />);
  }
}

export const HEAD_SLOT = '<!--seo-head-->';
export const BODY_SLOT = '<!--seo-body-->';

/** The built site template (dist/site/index.html before prerendering) filled in for one route. */
export function renderPage(template: string, route: PublicRoute, publicUrl: string, opts: HeadOptions = {}): string {
  if (!template.includes(HEAD_SLOT) || !template.includes(BODY_SLOT)) throw new Error('site template is missing the <!--seo-head--> or <!--seo-body--> slot');
  return template.replace(HEAD_SLOT, () => headTags(route, publicUrl, opts)).replace(BODY_SLOT, () => renderBody(route.page));
}

export const routeFor = (path: string) => PUBLIC_ROUTES.find((r) => r.path === path);

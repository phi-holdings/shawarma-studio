// Optional, cookieless page analytics with Umami (https://umami.is): the build adds Umami's script to the
// app shell and the public pages when VITE_UMAMI_WEBSITE_ID and VITE_UMAMI_SRC are both set. Never in
// the song runtime page. Query strings and hashes are not sent (they can hold checkout ids), and
// browsers with Do Not Track on are not counted.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The <script> tag, or '' when analytics is off or the settings are not a website id and an https URL. */
export function umamiTag(websiteId: string | undefined, src: string | undefined): string {
  const id = websiteId?.trim();
  const url = src?.trim();
  if (!id || !url || !UUID.test(id)) return '';
  let u: URL;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return '';
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<script defer src="${attr(u.href)}" data-website-id="${attr(id)}" data-do-not-track="true" data-exclude-search="true" data-exclude-hash="true"></script>`;
}

/** Adds the tag before </head> of the app shell and the public pages' template; leaves runtime.html alone. */
export function withAnalytics(html: string, filename: string, tag: string): string {
  if (!tag || /runtime\.html$/.test(filename)) return html;
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

/**
 * `<meta name="shawarma-connect">` naming the browser error tracker's ingest origin (from the build's
 * VITE_SENTRY_DSN), so the server's Content-Security-Policy lets the reports out
 * (server/src/http/securityHeaders.ts pageOrigins). '' when there is no valid https DSN.
 */
export function reportOriginTag(dsn: string | undefined): string {
  const d = dsn?.trim();
  if (!d) return '';
  let u: URL;
  try { u = new URL(d); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  return `<meta name="shawarma-connect" content="${u.origin}">`;
}

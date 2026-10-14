// Gate for requests made by the opaque-origin song runtime (runtime.html), shared by the Vite
// dev/preview server and the API server when it serves the production build.
//
// The runtime iframe has an opaque origin, so the browser loads its module scripts in CORS mode with
// `Origin: null`. `Origin: null` is also what *any* sandboxed page on any website sends, so such
// requests are only served when they demonstrably come from our runtime page:
//   - the Referer is this server's own origin (http(s)://localhost:<port>/ or http://127.0.0.1:<port>/,
//     the same host:port the request was sent to),
//   - the destination is a script/worklet (a song's fetch() has destination "empty"),
//   - the path passes the server's own check (`allowPath`), contains no '..' and asks for no
//     raw/url/inline/worker transform (Vite would turn a file into a string).
// Everything else with `Origin: null` is denied. /api is left alone: the API guard rejects
// `Origin: null` itself.

export interface GateRequest { url?: string; headers: Record<string, string | string[] | undefined> }

/** `pass`: not a null-origin request (or /api): untouched. `allow`: serve with ACAO null. `deny`: 403. */
export type Verdict = 'pass' | 'allow' | 'deny';

const SCRIPT_DESTS = new Set(['script', 'audioworklet', 'worker', 'sharedworker', 'paintworklet']);
const TRANSFORM_QUERY = /(^|&)(raw|url|inline|worker|sharedworker)(=|&|$)/;
const header = (h: GateRequest['headers'], k: string) => { const v = h[k]; return Array.isArray(v) ? v[0] : v; };

export function nullOriginVerdict(req: GateRequest, opts: {
  allowPath?: (decodedPath: string) => boolean;
  /** Hosted mode: PUBLIC_URL's host name, accepted in the Referer besides localhost / 127.0.0.1 (https only). */
  publicHostname?: string;
} = {}): Verdict {
  const h = req.headers;
  if (header(h, 'origin') !== 'null') return 'pass';
  const url = req.url ?? '';
  if (url.startsWith('/api/') || url === '/api') return 'pass';
  const host = header(h, 'host') ?? '';
  const ref = header(h, 'referer');
  let refOk = false;
  try {
    const r = new URL(ref ?? '');
    const local = (r.protocol === 'http:' || r.protocol === 'https:') && /^(localhost|127\.0\.0\.1)$/.test(r.hostname);
    const published = r.protocol === 'https:' && Boolean(opts.publicHostname) && r.hostname === opts.publicHostname;
    refOk = (local || published) && r.host === host;
  } catch { refOk = false; }
  if (!refOk || !SCRIPT_DESTS.has(String(header(h, 'sec-fetch-dest')))) return 'deny';
  const [rawPath, query = ''] = url.split('?');
  let p: string;
  try { p = decodeURIComponent(rawPath); } catch { return 'deny'; }
  if (TRANSFORM_QUERY.test(query) || p.includes('..') || p.includes('\0')) return 'deny';
  if (opts.allowPath && !opts.allowPath(p)) return 'deny';
  return 'allow';
}

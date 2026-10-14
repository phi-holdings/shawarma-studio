// Dev/preview-server gate for requests made by the opaque-origin song runtime (runtime.html); the
// rules are in shared/src/runtimeGate.ts (the API server applies the same ones to the production build).
// Vite-specific: /@fs/ paths are only served from the shared workspace package or node_modules.
// Chromium sends no Referer for a sandboxed document's own <script src> tags, so runtime.html loads
// its entry with an inline `import` (see inlineModuleImports), which does send one.
// (relative import: vite.config.ts loads this file outside Vite's own resolution)
import { nullOriginVerdict, type GateRequest, type Verdict } from '../../../shared/src/runtimeGate';

export type { GateRequest, Verdict };
export interface GateResponse { statusCode: number; setHeader(name: string, value: string): unknown; end(body?: string): unknown }

export function runtimeOriginVerdict(req: GateRequest, opts: { sharedSrcPrefix: string }): Verdict {
  return nullOriginVerdict(req, {
    allowPath: (p) => !p.startsWith('/@fs/') || p.includes('/node_modules/') || p.startsWith(opts.sharedSrcPrefix),
  });
}

export function runtimeOriginGate(opts: { sharedSrcPrefix: string }) {
  return (req: GateRequest, res: GateResponse, next: () => void) => {
    const v = runtimeOriginVerdict(req, opts);
    if (v === 'deny') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('forbidden: null-origin request not from the song runtime page');
      return;
    }
    if (v === 'allow') res.setHeader('Access-Control-Allow-Origin', 'null');
    // the app page and the runtime load the same chunks; without Vary a cached same-origin copy
    // (no ACAO) would be reused for the runtime's CORS request and fail
    if (!(req.url ?? '').startsWith('/api')) res.setHeader('Vary', 'Origin');
    next();
  };
}

/**
 * Rewrites `<script type="module" src="X">` in runtime.html to `<script type="module">import "X";</script>`
 * and drops `<link rel="modulepreload">` (also fetched without a Referer; the imports load the chunks).
 */
export function inlineModuleImports(html: string): string {
  return html.replace(/\s*<link\b[^>]*\brel="modulepreload"[^>]*>/g, '').replace(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)><\/script>/g, (tag, a: string, src: string, b: string) => {
    if (!/type="module"/.test(a + b)) return tag;
    return `<script type="module">import ${JSON.stringify(src)};</script>`;
  });
}

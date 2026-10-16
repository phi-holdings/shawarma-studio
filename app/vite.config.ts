import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import { inlineModuleImports, runtimeOriginGate } from './src/dev/runtimeCors';
import { PUBLIC_ROUTES } from './src/seo/routes';
import { reportOriginTag, umamiTag, withAnalytics } from './src/seo/analytics';

const sharedSrc = `/@fs${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/src')}/`;
const serverPort = Number(process.env.SHAWARMA_SERVER_PORT ?? 8787);
// The node_modules that holds the app's packages. Inside the private repo that is the parent
// workspace's, outside studio/, which Vite's own workspace root would not let the dev server read
// (the font files were refused).
const resolvedVite = createRequire(import.meta.url).resolve('vite');
const depsRoot = resolvedVite.slice(0, resolvedVite.indexOf(`${path.sep}node_modules${path.sep}`) + '/node_modules'.length);

/** Gate + inline-import rewrite for the opaque-origin song runtime; see src/dev/runtimeCors.ts. */
function runtimeFrame(): Plugin {
  const gate = runtimeOriginGate({ sharedSrcPrefix: sharedSrc });
  return {
    name: 'shawarma-runtime-frame',
    configureServer: (server) => { server.middlewares.use(gate); },
    configurePreviewServer: (server) => { server.middlewares.use(gate); },
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => (ctx.filename.endsWith('runtime.html') ? inlineModuleImports(html) : html),
    },
  };
}

/**
 * `SHAWARMA_PREVIEW_SITE=1 vite preview` serves the prerendered public pages at their real paths
 * (/, /privacy, ...) the way the server does for signed-out visitors; used for Lighthouse runs.
 */
function previewPublicSite(): Plugin {
  const files = new Map(PUBLIC_ROUTES.map((r) => [r.path, `/${r.file}`]));
  return {
    name: 'shawarma-preview-public-site',
    configurePreviewServer: (server) => {
      if (process.env.SHAWARMA_PREVIEW_SITE !== '1') return;
      server.middlewares.use((req, _res, next) => {
        const [pathname, query] = (req.url ?? '/').split('?');
        const file = files.get(pathname);
        if (file) req.url = query === undefined ? file : `${file}?${query}`;
        next();
      });
    },
  };
}

/**
 * After a client build, prerender the public pages and write robots.txt + sitemap.xml into the same
 * outDir (scripts/prerender.mjs, a separate process so it gets its own Vite SSR loader). PUBLIC_URL sets
 * every absolute URL in them.
 */
function prerenderPublicSite(): Plugin {
  let outDir = '';
  return {
    name: 'shawarma-prerender-public-site',
    apply: 'build',
    configResolved: (config) => { outDir = config.build.ssr ? '' : path.resolve(config.root, config.build.outDir); },
    closeBundle: {
      sequential: true,
      handler() {
        if (!outDir) return;
        const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'scripts/prerender.mjs');
        execFileSync(process.execPath, [script, '--outDir', outDir], { stdio: 'inherit' });
      },
    },
  };
}

/**
 * Umami's script in the app shell and the public pages when VITE_UMAMI_WEBSITE_ID and VITE_UMAMI_SRC are
 * set, and the error tracker's origin when VITE_SENTRY_DSN is (src/seo/analytics.ts); the server's CSP
 * reads both from the page.
 */
function analytics(): Plugin {
  let tag = '';
  return {
    name: 'shawarma-analytics',
    // config.env has the VITE_ settings from the environment and .env files
    configResolved: (config) => {
      tag = [reportOriginTag(config.env.VITE_SENTRY_DSN), umamiTag(config.env.VITE_UMAMI_WEBSITE_ID, config.env.VITE_UMAMI_SRC)].filter(Boolean).join('\n    ');
    },
    transformIndexHtml: { order: 'post', handler: (html, ctx) => withAnalytics(html, ctx.filename, tag) },
  };
}

/**
 * The studio commit this build comes from (VITE_STUDIO_COMMIT, else `git rev-parse HEAD` in studio/), and
 * whether the tree had uncommitted changes: the /source page links that exact commit, and Help & feedback
 * sends it along. Empty outside git.
 */
function studioCommit(): void {
  const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...args: string[]) => execFileSync('git', ['-C', studioDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (process.env.VITE_STUDIO_COMMIT === undefined) {
    try {
      process.env.VITE_STUDIO_COMMIT = git('rev-parse', 'HEAD');
      process.env.VITE_STUDIO_DIRTY = git('status', '--porcelain', '--untracked-files=no') ? '1' : '';
    } catch { process.env.VITE_STUDIO_COMMIT = ''; }
  }
}
studioCommit();

export default defineConfig({
  plugins: [react(), runtimeFrame(), previewPublicSite(), prerenderPublicSite(), analytics()],
  server: { port: 5173, host: '127.0.0.1', fs: { allow: [searchForWorkspaceRoot(process.cwd()), depsRoot] }, proxy: { '/api': `http://127.0.0.1:${serverPort}`, '/auth': `http://127.0.0.1:${serverPort}` } },
  preview: { proxy: { '/api': `http://127.0.0.1:${serverPort}`, '/auth': `http://127.0.0.1:${serverPort}` } },
  // scan both pages up front so the runtime's deps don't trigger a mid-session re-optimise + reload
  optimizeDeps: { entries: ['index.html', 'runtime.html'] },
  build: {
    // site: the prerendered public pages' template (no app bundle); scripts/prerender.mjs fills it in
    rollupOptions: { input: { main: 'index.html', runtime: 'runtime.html', site: 'site/index.html' } },
    // no <link rel=modulepreload> injected for dynamic imports: in the runtime those preloads go out
    // without a Referer and the null-origin gate refuses them (the imports themselves load fine)
    modulePreload: { resolveDependencies: (_file, deps, ctx) => (ctx.hostType === 'js' ? [] : deps) },
  },
});

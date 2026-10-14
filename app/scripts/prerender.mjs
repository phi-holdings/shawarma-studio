// After `vite build`: prerender the public pages into dist/site/**, and write dist/robots.txt and
// dist/sitemap.xml. Every absolute URL comes from PUBLIC_URL (default http://localhost:8787), so set it
// to the production address and rebuild before deploying. See docs/seo.md.
//
//   PUBLIC_URL=https://shawarma.example pnpm build
//   node scripts/prerender.mjs [--outDir dist]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--outDir');
const dist = path.resolve(appDir, outArg > 0 ? process.argv[outArg + 1] : 'dist');

/** Last commit date (YYYY-MM-DD) touching any of the files; today when uncommitted or outside git. */
function lastmod(files) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...files], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out && !dirty ? out : today;
  } catch { return today; }
}

const vite = await createServer({
  root: appDir,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  // its own optimizer cache: sharing node_modules/.vite with a running dev server (the e2e suite builds
  // while Vite serves) would rewrite that server's deps and leave it answering 504 Outdated Optimize Dep
  cacheDir: path.join(appDir, 'node_modules/.vite-prerender'),
});
try {
  const seo = await vite.ssrLoadModule('/src/seo/render.tsx');
  const publicUrl = seo.normalizePublicUrl(process.env.PUBLIC_URL);
  const templateFile = path.join(dist, 'site/index.html');
  const template = await fs.readFile(templateFile, 'utf8').catch(() => {
    throw new Error(`${templateFile} is missing: run \`vite build\` first (the site entry is studio/app/site/index.html)`);
  });
  const fonts = await fs.readdir(path.join(dist, 'assets'));
  const geist = fonts.find((f) => /^geist-latin-wght-normal-[\w-]+\.woff2$/.test(f));
  if (!geist) throw new Error('the Geist latin woff2 is not in dist/assets; the font preload needs it');
  const fontHref = `/assets/${geist}`;

  const lastmods = {};
  for (const route of seo.PUBLIC_ROUTES) {
    const file = path.join(dist, route.file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, seo.renderPage(template, route, publicUrl, { fontHref }));
    lastmods[route.path] = lastmod(route.sources);
  }
  await fs.writeFile(path.join(dist, 'robots.txt'), seo.robotsTxt(publicUrl));
  await fs.writeFile(path.join(dist, 'sitemap.xml'), seo.sitemapXml(publicUrl, lastmods));
  console.log(`prerendered ${seo.PUBLIC_ROUTES.length} public pages, robots.txt and sitemap.xml for ${publicUrl}`);
} finally {
  await vite.close();
}

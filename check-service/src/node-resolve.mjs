// @kabelsalat/web's "main" is a browser IIFE bundle with no named exports, and Node ignores
// its "module" field, so `import { SalatRepl }` (done by @strudel/core) fails in Node.
// Redirect the specifier to the package's own ESM build.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// transitive dep of @strudel/core: resolve from there (pnpm strict layout)
const strudelRequire = createRequire(createRequire(import.meta.url).resolve('@strudel/core'));
const pkg = strudelRequire.resolve('@kabelsalat/web/package.json');
const esm = pathToFileURL(path.join(path.dirname(pkg), 'dist/index.mjs')).href;

export const redirect = { '@kabelsalat/web': esm };

export async function resolve(specifier, context, nextResolve) {
  if (specifier in redirect) return { url: redirect[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}

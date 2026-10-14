import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// @kabelsalat/web's "main" is a browser IIFE bundle and Node ignores its "module" field,
// so point imports at the package's own ESM build.
// (a transitive dep of @strudel/core, so resolve it from there under pnpm's strict layout)
const strudelRequire = createRequire(createRequire(import.meta.url).resolve('@strudel/core'));
const kabelsalatEsm = path.join(path.dirname(strudelRequire.resolve('@kabelsalat/web/package.json')), 'dist/index.mjs');

// Strudel packages stay externalised (Node loads them natively), so Node itself must apply the same redirect.
const registerHook = new URL('./src/register.mjs', import.meta.url).href;

export default defineConfig({
  resolve: { alias: { '@kabelsalat/web': kabelsalatEsm } },
  test: { pool: 'forks', poolOptions: { forks: { execArgv: ['--import', registerHook] } }, include: ['src/**/*.test.ts'], testTimeout: 20000 },
});

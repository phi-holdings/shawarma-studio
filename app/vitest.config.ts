import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// @kabelsalat/web (a dep of @strudel/core) has a browser IIFE as "main"; point Node tests at its ESM
// build and let Vitest transform the Strudel packages so the alias applies to them too.
const strudelRequire = createRequire(createRequire(import.meta.url).resolve('@strudel/core'));
const kabelsalatEsm = path.join(path.dirname(strudelRequire.resolve('@kabelsalat/web/package.json')), 'dist/index.mjs');

export default defineConfig({
  resolve: { alias: { '@kabelsalat/web': kabelsalatEsm } },
  test: { include: ['src/**/*.test.ts'], server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } } },
});

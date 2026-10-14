// shared/ is MIT (the platform, which is closed, uses it), so it must never depend on Strudel or any
// other copyleft code. This guard fails the build if an import of that kind appears.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const COPYLEFT = /from ['"](@strudel\/|@kabelsalat\/|superdough)|import\(['"](@strudel\/|superdough)/;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { license: string; dependencies?: Record<string, string> };

test('shared stays MIT: no Strudel imports, no copyleft dependencies', () => {
  expect(pkg.license).toBe('MIT');
  expect(Object.keys(pkg.dependencies ?? {}).filter((d) => /strudel|superdough|kabelsalat/.test(d))).toEqual([]);
  const dir = new URL('./', import.meta.url);
  const offenders = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && COPYLEFT.test(readFileSync(new URL(f, dir), 'utf8')));
  expect(offenders).toEqual([]);
});

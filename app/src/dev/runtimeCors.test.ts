import { expect, test } from 'vitest';
import { inlineModuleImports, runtimeOriginGate, runtimeOriginVerdict } from './runtimeCors';

const shared = '/@fs/repo/shared/src/';
const req = (url: string, h: Record<string, string>) => ({ url, headers: { host: 'localhost:5173', 'sec-fetch-dest': 'script', ...h } });
const v = (url: string, h: Record<string, string>) => runtimeOriginVerdict(req(url, h), { sharedSrcPrefix: shared });

test('null-origin module loads from our runtime page are allowed', () => {
  for (const ref of ['http://localhost:5173/runtime.html', 'http://localhost:5173/', 'http://localhost:5173/src/runtime/main.ts']) {
    expect(v('/src/runtime/main.ts', { origin: 'null', referer: ref }), ref).toBe('allow');
  }
  expect(v('/@fs/repo/shared/src/index.ts', { origin: 'null', referer: 'http://localhost:5173/x' })).toBe('allow');
  expect(v('/@fs/repo/node_modules/.vite/deps/x.js?v=1', { origin: 'null', referer: 'http://localhost:5173/x' })).toBe('allow');
  expect(v('/@fs/repo/shared/src/a%20b.ts', { origin: 'null', referer: 'http://localhost:5173/x' })).toBe('allow');
  expect(runtimeOriginVerdict({ url: '/src/a.ts', headers: { host: '127.0.0.1:5173', origin: 'null', referer: 'http://127.0.0.1:5173/runtime.html', 'sec-fetch-dest': 'script' } }, { sharedSrcPrefix: shared })).toBe('allow');
});

test('any other null-origin request is denied', () => {
  expect(v('/src/main.tsx', { origin: 'null', referer: 'https://evil.example/' })).toBe('deny');       // sandboxed iframe elsewhere
  expect(v('/src/main.tsx', { origin: 'null' })).toBe('deny');                                         // no-referrer
  expect(v('/src/main.tsx', { origin: 'null', referer: 'http://localhost:9999/' })).toBe('deny');      // another local port
  expect(v('/src/main.tsx', { origin: 'null', referer: 'http://localhost.evil.example:5173/' })).toBe('deny');
  expect(v('/src/main.tsx', { origin: 'null', referer: 'http://localhost:5173/', 'sec-fetch-dest': 'empty' })).toBe('deny'); // song fetch()
  expect(v('/src/main.tsx?raw', { origin: 'null', referer: 'http://localhost:5173/' })).toBe('deny');
  expect(v('/@fs/etc/passwd', { origin: 'null', referer: 'http://localhost:5173/' })).toBe('deny');
  expect(v('/@fs/repo/server/src/config.ts', { origin: 'null', referer: 'http://localhost:5173/' })).toBe('deny');
});

test('normal and /api requests pass through untouched', () => {
  expect(v('/src/main.tsx', {})).toBe('pass');
  expect(v('/src/main.tsx', { origin: 'http://localhost:5173' })).toBe('pass');
  expect(v('/api/projects', { origin: 'null' })).toBe('pass');
});

test('the middleware answers 403 or adds ACAO: null', () => {
  const gate = runtimeOriginGate({ sharedSrcPrefix: shared });
  const res = () => ({ statusCode: 200, headers: {} as Record<string, string>, body: '', setHeader(k: string, x: string) { this.headers[k] = x; }, end(b?: string) { this.body = b ?? ''; } });
  let nexted = 0;
  const bad = res();
  gate(req('/src/main.tsx', { origin: 'null', referer: 'https://evil.example/' }), bad, () => nexted++);
  expect([bad.statusCode, nexted]).toEqual([403, 0]);
  const ok = res();
  gate(req('/src/main.tsx', { origin: 'null', referer: 'http://localhost:5173/runtime.html' }), ok, () => nexted++);
  expect([ok.statusCode, ok.headers['Access-Control-Allow-Origin'], nexted]).toEqual([200, 'null', 1]);
});

test('runtime.html module script tags become inline imports (so they carry a Referer)', () => {
  expect(inlineModuleImports('<head>\n  <link rel="modulepreload" crossorigin href="/assets/c.js"></head>')).toBe('<head></head>');
  expect(inlineModuleImports('<script type="module" src="/@vite/client"></script><script type="module" crossorigin src="/assets/r.js"></script><script src="/classic.js"></script>'))
    .toBe('<script type="module">import "/@vite/client";</script><script type="module">import "/assets/r.js";</script><script src="/classic.js"></script>');
});

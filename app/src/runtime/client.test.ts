import { expect, test } from 'vitest';
import { runtimeUrl } from './client';
import { packsFromSearch, packsUrlFromSearch } from './packs';

test('the runtime is loaded from the other loopback hostname (another site), same scheme and port', () => {
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://localhost:5173/')).href).toBe('http://127.0.0.1:5173/runtime.html?n=abc');
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://127.0.0.1:8787/x')).href).toBe('http://localhost:8787/runtime.html?n=abc');
  // any other host keeps the app's own origin
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://my-mac.local:5173/')).href).toBe('http://my-mac.local:5173/runtime.html?n=abc');
});

test('hosted mode tells the runtime to load only the hosted sample packs; local mode loads all', () => {
  const hosted = runtimeUrl('/runtime.html', 'abc', new URL('https://shawarma.example/'), 'hosted');
  expect(hosted.href).toBe('https://shawarma.example/runtime.html?n=abc&p=hosted');
  expect(packsFromSearch(hosted.search)).toBe('hosted');
  expect(packsFromSearch(runtimeUrl('/runtime.html', 'abc', new URL('http://localhost:5173/'), 'all').search)).toBe('all');
  expect(packsFromSearch('?n=abc&p=bogus')).toBe('all');
});

test('self-hosted sound packs: their URL travels to the runtime; none (or not http) means Strudel\'s CDNs', () => {
  const u = runtimeUrl('/runtime.html', 'abc', new URL('https://shawarma.example/'), 'hosted', 'https://shawarma.example/packs');
  expect(u.searchParams.get('s')).toBe('https://shawarma.example/packs');
  expect(packsUrlFromSearch(u.search)).toBe('https://shawarma.example/packs');
  expect(runtimeUrl('/runtime.html', 'abc', new URL('https://shawarma.example/'), 'hosted').searchParams.has('s')).toBe(false);
  expect(packsUrlFromSearch('?n=abc')).toBeNull();
  expect(packsUrlFromSearch(`?s=${encodeURIComponent('javascript:alert(1)')}`)).toBeNull();
});

test('WebKit (Safari, any iOS browser) is recognised as having no site isolation', async () => {
  const { isWebKitOnly } = await import('./client');
  const ua = {
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0',
    iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  };
  expect(isWebKitOnly(ua.safari)).toBe(true);
  expect(isWebKitOnly(ua.iosChrome)).toBe(true);
  expect(isWebKitOnly(ua.chrome)).toBe(false);
  expect(isWebKitOnly(ua.edge)).toBe(false);
  expect(isWebKitOnly(ua.firefox)).toBe(false);
});

test('a pre-flight that could not be made is not remembered: the next run of the same code asks again', async () => {
  const { RuntimeClient } = await import('./client');
  let calls = 0;
  let up = false;
  // only the verdict cache is exercised: no frame is mounted
  const rc = Object.assign(Object.create(RuntimeClient.prototype), {
    prechecks: new Map(),
    precheck: async () => { calls++; if (!up) throw new Error('503'); return { hang: false }; },
  }) as unknown as { verdict(code: string): Promise<{ hang: boolean; unchecked?: boolean }> };
  expect(await rc.verdict('s("bd")')).toEqual({ hang: false, unchecked: true });
  up = true;
  expect(await rc.verdict('s("bd")')).toEqual({ hang: false });
  expect(await rc.verdict('s("bd")')).toEqual({ hang: false }); // a real verdict is remembered
  expect(calls).toBe(2);
});

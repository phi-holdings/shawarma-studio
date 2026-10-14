import { expect, test } from 'vitest';
import { runtimeUrl } from './client';

test('the runtime is loaded from the other loopback hostname (another site), same scheme and port', () => {
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://localhost:5173/')).href).toBe('http://127.0.0.1:5173/runtime.html?n=abc');
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://127.0.0.1:8787/x')).href).toBe('http://localhost:8787/runtime.html?n=abc');
  // any other host keeps the app's own origin
  expect(runtimeUrl('/runtime.html', 'abc', new URL('http://my-mac.local:5173/')).href).toBe('http://my-mac.local:5173/runtime.html?n=abc');
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

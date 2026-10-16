import { expect, test } from 'vitest';
import { reportOriginTag, umamiTag, withAnalytics } from './analytics';
import { scrubBrowserEvent } from '../monitoring';

const ID = '0b6a3d3e-1c2f-4e8a-9b7c-123456789abc';

test('umami: a tag only with both settings, a website id and an https URL', () => {
  expect(umamiTag(undefined, undefined)).toBe('');
  expect(umamiTag(ID, '')).toBe('');
  expect(umamiTag('not-an-id', 'https://analytics.phi.holdings/script.js')).toBe('');
  expect(umamiTag(ID, 'http://analytics.example/script.js')).toBe('');
  expect(umamiTag(ID, 'javascript:alert(1)')).toBe('');
  const tag = umamiTag(ID, 'https://analytics.phi.holdings/script.js');
  expect(tag).toBe(`<script defer src="https://analytics.phi.holdings/script.js" data-website-id="${ID}" data-do-not-track="true" data-exclude-search="true" data-exclude-hash="true"></script>`);
  expect(withAnalytics('<head></head>', '/x/index.html', tag)).toContain(tag);
  expect(withAnalytics('<head></head>', '/x/site/index.html', tag)).toContain(tag);
  expect(withAnalytics('<head></head>', '/x/runtime.html', tag)).toBe('<head></head>');
  expect(withAnalytics('<head></head>', '/x/index.html', '')).toBe('<head></head>');
});

test('browser error reports: no breadcrumbs, user, extra or query; emails redacted; text cut short', () => {
  const out = scrubBrowserEvent({
    message: 'failed for me@example.com',
    request: { url: 'https://s.example/billing/success?checkout_id=1#x', headers: { a: 'b' } },
    user: { email: 'me@example.com' },
    breadcrumbs: [{ message: 'click' }],
    extra: { code: 's("bd")' },
    exception: { values: [{ value: 'x'.repeat(1000) }] },
  });
  expect(out.message).toBe('failed for [email]');
  expect(out.request).toEqual({ url: 'https://s.example/billing/success' });
  expect(out.user).toBeUndefined();
  expect(out.extra).toBeUndefined();
  expect(out.breadcrumbs).toEqual([]);
  expect(out.exception?.values?.[0].value).toHaveLength(300);
});

test('browser error reports: the ingest origin is named for the CSP, never the key', () => {
  expect(reportOriginTag(undefined)).toBe('');
  expect(reportOriginTag('http://k@o1.ingest.example/1')).toBe('');
  expect(reportOriginTag('https://publickey@o1.ingest.sentry.io/123')).toBe('<meta name="shawarma-connect" content="https://o1.ingest.sentry.io">');
});

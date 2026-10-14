import { expect, test } from 'vitest';
import { friendlyApiError } from './apiErrors';

const api = (status: number, type: string, message: string) => `${status} ${JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_1' })}`;

test('raw API errors become one plain sentence', () => {
  expect(friendlyApiError(api(401, 'authentication_error', 'invalid x-api-key'))).toEqual({ message: "Anthropic didn't accept your API key. Check the key in Settings → Shawarma.", auth: true });
  expect(friendlyApiError(api(429, 'rate_limit_error', 'slow down')).message).toMatch(/limiting requests/);
  expect(friendlyApiError(api(529, 'overloaded_error', 'Overloaded')).message).toMatch(/busy/);
  expect(friendlyApiError(api(500, 'api_error', 'Internal')).message).toMatch(/on its side/);
  expect(friendlyApiError(api(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')).message).toMatch(/out of credit/);
  expect(friendlyApiError(api(400, 'invalid_request_error', 'messages: text content blocks must be non-empty')).message)
    .toBe('Anthropic refused the request: messages: text content blocks must be non-empty');
  expect(friendlyApiError('Connection error.').message).toMatch(/internet connection/);
});

test('text that is not an API error passes through, so running it twice is harmless', () => {
  expect(friendlyApiError('The reply was cut off (max tokens).')).toEqual({ message: 'The reply was cut off (max tokens).' });
  const once = friendlyApiError(api(401, 'authentication_error', 'x')).message;
  expect(friendlyApiError(once).message).toBe(once);
  expect(friendlyApiError('120 bpm is the default').message).toBe('120 bpm is the default');
});

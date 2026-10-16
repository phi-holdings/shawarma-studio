import { expect, test } from 'vitest';
import { usd, yearlySaving } from '../landing/proPrices';
import { loadPrices } from './prices';

test('prices read as dollars, and the yearly saving in months', () => {
  expect(usd(12)).toBe('$12');
  expect(usd(9.5)).toBe('$9.50');
  expect(yearlySaving({ month: 12, year: 120 })).toBe('two months free');
  expect(yearlySaving({ month: 10, year: 110 })).toBe('one month free');
  expect(yearlySaving({ month: 12, year: 144 })).toBeNull();
});

/** Just enough of a Document: elements with data-price. */
function fakeDoc(keys: string[]) {
  const els = keys.map((k) => ({ dataset: { price: k }, textContent: 'old' }));
  return { els, doc: { querySelector: () => els[0] ?? null, querySelectorAll: () => els } as unknown as Document };
}

test("the page takes the server's prices; a failure keeps the prerendered ones", async () => {
  const { els, doc } = fakeDoc(['month', 'year', 'saving']);
  await loadPrices(doc, (async () => new Response(JSON.stringify({ prices: { month: 15, year: 150 } }))) as typeof fetch);
  expect(els.map((e) => e.textContent)).toEqual(['$15', '$150', ' (two months free)']);
  const kept = fakeDoc(['month']);
  await loadPrices(kept.doc, (async () => { throw new Error('offline'); }) as typeof fetch);
  await loadPrices(kept.doc, (async () => new Response('nope', { status: 500 })) as typeof fetch);
  expect(kept.els[0].textContent).toBe('old');
});

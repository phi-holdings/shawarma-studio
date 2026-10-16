// The public pages are prerendered with DEFAULT_PRICES; this puts in the server's prices (GET /api/pricing)
// when they differ, so the server's PRICES stay the one source. Fails quietly: the defaults stay.
import { usd, yearlySaving, type ProPrices } from '../landing/proPrices';

export function applyPrices(doc: Document, p: ProPrices): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-price]'))) {
    const k = el.dataset.price;
    if (k === 'month' || k === 'year') el.textContent = usd(p[k]);
    if (k === 'saving') { const s = yearlySaving(p); el.textContent = s ? ` (${s})` : ''; }
  }
}

export async function loadPrices(doc: Document, f: typeof fetch = fetch): Promise<void> {
  if (!doc.querySelector('[data-price]')) return;
  try {
    const r = await f('/api/pricing');
    if (!r.ok) return;
    const { prices } = (await r.json()) as { prices?: Partial<ProPrices> };
    if (typeof prices?.month === 'number' && typeof prices?.year === 'number') applyPrices(doc, { month: prices.month, year: prices.year });
  } catch { /* keep the prerendered prices */ }
}

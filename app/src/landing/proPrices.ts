// Pro's prices as the public pages show them. The server owns them (server/src/billing/plans.ts PRICES,
// env PRO_PRICE_MONTHLY_USD / PRO_PRICE_YEARLY_USD) and serves them at GET /api/pricing; these are its
// defaults, used to prerender /pricing and the landing page (a server test keeps them equal), and the
// page replaces them with the server's numbers when they differ.
export interface ProPrices { month: number; year: number }

export const DEFAULT_PRICES: ProPrices = { month: 12, year: 120 };
export const TRIAL_DAYS = 7;

export const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** "two months free" when the yearly price is ten months; otherwise nothing. */
export function yearlySaving(p: ProPrices): string | null {
  const months = 12 - p.year / p.month;
  if (!(months >= 1)) return null;
  return Number.isInteger(months) ? `${['', 'one', 'two', 'three', 'four'][months] ?? months} month${months === 1 ? '' : 's'} free` : null;
}
export const VAT_NOTE = 'Prices exclude VAT where applicable; Polar, our payment provider, handles tax.';

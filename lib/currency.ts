/* The currencies a division can be priced in. Both the registration fee and
 * the prize money use the division's single `settings.currency` — an event
 * that collects entries in THB does not pay out in USD, so one code per
 * division is the whole model. The symbol is display only; amounts are
 * stored as plain numbers alongside the code. */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  THB: '฿', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', SGD: 'S$',
};

export const CURRENCIES = Object.keys(CURRENCY_SYMBOLS);

/** Whitelisted so a hand-made request cannot store a code nothing can render. */
export function normalizeCurrency(v: unknown): string {
  return typeof v === 'string' && CURRENCIES.includes(v) ? v : 'THB';
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? '';
}

/** "฿50,000". Falls back to "50,000 XYZ" for a code with no symbol. */
export function formatMoney(amount: number, code: string): string {
  const value = Math.round(amount).toLocaleString('en-US');
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${value}` : `${value} ${code}`;
}

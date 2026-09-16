/* ── Turning what someone types into a wa.me link ─────────────────
 *
 * An organizer types their number the way they say it out loud —
 * "081 234 5678", "+66 81 234 5678", "0066812345678". A wa.me link
 * accepts exactly one of those shapes: full international digits, no
 * plus, no separators, no leading zero. So the shapes are reconciled
 * once, here, on save, and the database holds only the form the link
 * needs (see migration 0024).
 *
 * ── The one guess this makes ─────────────────────────────────────
 * A number starting with a single 0 is a *local* number, and local means
 * nothing without knowing the country. There is no country on an
 * organizer's profile to read it from, so DEFAULT_COUNTRY below is the
 * assumption — Thailand, because that is where the events are.
 *
 * The assumption is escapable and never silent: any number that already
 * carries its country — anything without a leading trunk zero once a
 * written-out 00 has been stripped — is taken at its word, whatever
 * country it belongs to. And `usedDefaultCountry` on the result says when
 * the guess was applied, so the profile form can show what it settled on
 * rather than quietly saving a number the organizer did not mean.
 *
 * If organizers outside Thailand ever sign up in numbers, the honest fix
 * is a country picker on the profile, not a cleverer guess here.
 */

/** Thailand. The only place this is decided. */
export const DEFAULT_COUNTRY = { code: '66', name: 'Thailand' } as const;

/* Country calling codes are one to three digits. These are the complete
 * one- and two-digit sets; anything else uses three digits. That is enough
 * to split a stored E.164 number without maintaining a country-name list in
 * this small formatting helper. */
const ONE_DIGIT_COUNTRY_CODES = new Set(['1', '7']);
const TWO_DIGIT_COUNTRY_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43',
  '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56',
  '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
  '86', '90', '91', '92', '93', '94', '95', '98',
]);

export interface PhoneNumberParts {
  countryCode: string;
  number: string;
}

/* A leading ! keeps a private number in the existing text column without
 * turning it into a usable public link. It is deliberately outside the
 * digits-only E.164 value, and every reader comes through these helpers. */
const PRIVATE_MARKER = '!';

export function isWhatsappPublic(stored: string | null | undefined): boolean {
  return !(stored ?? '').startsWith(PRIVATE_MARKER);
}

export function storedWhatsappNumber(digits: string, publiclyVisible: boolean): string {
  const normalized = digits.replace(/\D/g, '');
  return publiclyVisible ? normalized : `${PRIVATE_MARKER}${normalized}`;
}

export function whatsappDigits(stored: string | null | undefined): string | null {
  const digits = (stored ?? '').replace(/\D/g, '');
  return digits || null;
}

/** Split stored international digits for the profile form. New profiles
 * start in Thailand; saved numbers retain their actual calling code. */
export function splitInternationalNumber(
  stored: string | null | undefined,
): PhoneNumberParts {
  const digits = (stored ?? '').replace(/\D/g, '');
  if (!digits) return { countryCode: DEFAULT_COUNTRY.code, number: '' };

  const codeLength = ONE_DIGIT_COUNTRY_CODES.has(digits.slice(0, 1))
    ? 1
    : TWO_DIGIT_COUNTRY_CODES.has(digits.slice(0, 2))
      ? 2
      : Math.min(3, digits.length);

  return {
    countryCode: digits.slice(0, codeLength),
    number: digits.slice(codeLength),
  };
}

/* E.164 allows 15 digits at most, and the shortest usable international
 * number is around 8. Outside that range it is a typo, not a number. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

export type WhatsappParse =
  | { ok: true; value: string; usedDefaultCountry: boolean }
  | { ok: false; reason: string };

/**
 * Normalise a typed number to wa.me digits, or explain why it cannot be.
 *
 * The failure `reason` is written to be shown to the organizer as-is —
 * it is the error the profile form displays, so it says what to do rather
 * than what went wrong internally.
 */
export function parseWhatsappNumber(input: string): WhatsappParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Enter a number, or leave it empty to remove it' };

  /* Everything a person types to make a number readable — spaces,
   * dashes, brackets, dots, the leading + — is noise once the digits are
   * out. What is left is decided by two marks only: a leading 00, and a
   * leading trunk zero. */
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'That does not look like a phone number' };

  // 00 is the written-out form of +. Strip it and the rest speaks for itself.
  const base = digits.startsWith('00') ? digits.slice(2) : digits;

  let international: string;
  let usedDefaultCountry = false;

  if (base.startsWith('0')) {
    /* A trunk zero survived, so what is in hand is a *local* number
     * however it was prefixed — "0812345678" typed plainly, and also
     * "000812345678", where the extra zero was a slipped finger rather
     * than an international prefix. Either way an international number
     * never begins with a zero, so this is the branch that guesses. */
    international = DEFAULT_COUNTRY.code + base.replace(/^0+/, '');
    usedDefaultCountry = true;
  } else {
    /* No trunk zero: the number already carries its country, whether it
     * was written with a + or not. Taken at face value — prefixing a
     * country code onto a number that already has one is the single
     * mistake that yields a *valid-looking* wrong number. */
    international = base;
  }

  if (international.length < MIN_DIGITS) {
    return { ok: false, reason: 'That number looks too short' };
  }
  if (international.length > MAX_DIGITS) {
    return { ok: false, reason: 'That number looks too long' };
  }

  return { ok: true, value: international, usedDefaultCountry };
}

/** The link itself. Null in, null out — an organizer without a number
 *  gets no button rather than a button to nowhere. */
export function whatsappLink(stored: string | null | undefined): string | null {
  if (!isWhatsappPublic(stored)) return null;
  const digits = whatsappDigits(stored) ?? '';
  return digits ? `https://wa.me/${digits}` : null;
}

/** How a stored number is shown back to a human. Deliberately not
 *  per-country grouping — getting that wrong for one country is worse
 *  than not grouping at all, and a plus is enough to read it by. */
export function formatWhatsappNumber(stored: string | null | undefined): string | null {
  const digits = whatsappDigits(stored) ?? '';
  return digits ? `+${digits}` : null;
}

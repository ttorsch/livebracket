import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWhatsappNumber,
  whatsappLink,
  formatWhatsappNumber,
  splitInternationalNumber,
  isWhatsappPublic,
  storedWhatsappNumber,
  whatsappDigits,
  DEFAULT_COUNTRY,
} from './whatsappNumber.ts';

/* What an organizer types is the least predictable input in the app —
 * every country writes a phone number differently, and the same person
 * writes theirs two ways on two days. These tests are mostly about the
 * one branch that *guesses*: a leading zero means a local number, and a
 * local number means nothing without a country. Everything that says its
 * own country must survive untouched, because prefixing a country code
 * onto a number that already has one produces a number that looks fine
 * and reaches a stranger.
 */

const ok = (input: string) => {
  const result = parseWhatsappNumber(input);
  assert.equal(result.ok, true, `expected ${input} to parse`);
  return result as Extract<typeof result, { ok: true }>;
};

describe('parseWhatsappNumber — numbers that name their own country', () => {
  it('takes a + number at its word', () => {
    assert.equal(ok('+66812345678').value, '66812345678');
  });

  it('ignores the spaces and dashes people read numbers with', () => {
    assert.equal(ok('+66 81-234 5678').value, '66812345678');
    assert.equal(ok('+66 (81) 234.5678').value, '66812345678');
  });

  it('treats 00 as the other way of writing +', () => {
    assert.equal(ok('0066812345678').value, '66812345678');
  });

  it('does not apply the default country to either form', () => {
    assert.equal(ok('+4917612345678').usedDefaultCountry, false);
    assert.equal(ok('004917612345678').usedDefaultCountry, false);
  });

  it('leaves a non-Thai number alone rather than making it Thai', () => {
    // The bug this guards: 66 + 4917... would dial somebody in Thailand.
    assert.equal(ok('+4917612345678').value, '4917612345678');
  });
});

describe('parseWhatsappNumber — local numbers', () => {
  it('swaps a leading zero for the default country code', () => {
    const result = ok('0812345678');
    assert.equal(result.value, `${DEFAULT_COUNTRY.code}812345678`);
    assert.equal(result.usedDefaultCountry, true);
  });

  it('says when it guessed, so the form can show what it settled on', () => {
    assert.equal(ok('081 234 5678').usedDefaultCountry, true);
    assert.equal(ok('+66812345678').usedDefaultCountry, false);
  });

  it('treats a run of leading zeroes as a typo, not as 00', () => {
    // "000812345678" is a slipped finger, not an international prefix.
    assert.equal(ok('000812345678').value, `${DEFAULT_COUNTRY.code}812345678`);
  });
});

describe('parseWhatsappNumber — no leading zero and no plus', () => {
  it('assumes it is already international rather than prefixing again', () => {
    const result = ok('66812345678');
    assert.equal(result.value, '66812345678');
    assert.equal(result.usedDefaultCountry, false);
  });
});

describe('parseWhatsappNumber — what it refuses', () => {
  it('refuses empty input with a message about removing it', () => {
    const result = parseWhatsappNumber('');
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /leave it empty/i);
  });

  it('refuses text with no digits in it', () => {
    assert.equal(parseWhatsappNumber('call me').ok, false);
  });

  it('refuses a number too short to be one', () => {
    const result = parseWhatsappNumber('+6681');
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /too short/i);
  });

  it('refuses more digits than E.164 allows', () => {
    const result = parseWhatsappNumber('+1234567890123456');
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /too long/i);
  });
});

describe('whatsappLink', () => {
  it('builds the wa.me link from stored digits', () => {
    assert.equal(whatsappLink('66812345678'), 'https://wa.me/66812345678');
  });

  it('gives nothing for an organizer who has not set one', () => {
    assert.equal(whatsappLink(null), null);
    assert.equal(whatsappLink(undefined), null);
    assert.equal(whatsappLink(''), null);
  });

  it('survives a stored value that somehow kept its punctuation', () => {
    assert.equal(whatsappLink('+66 81 234 5678'), 'https://wa.me/66812345678');
  });

  it('does not build a link for a private number', () => {
    assert.equal(whatsappLink('!66812345678'), null);
  });
});

describe('phone number visibility', () => {
  it('marks a private number without losing its digits', () => {
    const stored = storedWhatsappNumber('66812345678', false);
    assert.equal(stored, '!66812345678');
    assert.equal(isWhatsappPublic(stored), false);
    assert.equal(whatsappDigits(stored), '66812345678');
  });

  it('leaves a public number in E.164 digits', () => {
    assert.equal(storedWhatsappNumber('66812345678', true), '66812345678');
    assert.equal(isWhatsappPublic('66812345678'), true);
  });
});

describe('formatWhatsappNumber', () => {
  it('shows a stored number back with its plus', () => {
    assert.equal(formatWhatsappNumber('66812345678'), '+66812345678');
  });

  it('gives nothing when there is nothing', () => {
    assert.equal(formatWhatsappNumber(null), null);
  });
});

describe('splitInternationalNumber', () => {
  it('splits the country code from a saved Thai number', () => {
    assert.deepEqual(splitInternationalNumber('66812345678'), {
      countryCode: '66',
      number: '812345678',
    });
  });

  it('handles one- and three-digit country codes', () => {
    assert.deepEqual(splitInternationalNumber('14155552671'), {
      countryCode: '1',
      number: '4155552671',
    });
    assert.deepEqual(splitInternationalNumber('85512345678'), {
      countryCode: '855',
      number: '12345678',
    });
  });

  it('defaults an empty profile to Thailand', () => {
    assert.deepEqual(splitInternationalNumber(null), {
      countryCode: DEFAULT_COUNTRY.code,
      number: '',
    });
  });
});

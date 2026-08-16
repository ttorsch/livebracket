// Unit tests for division eligibility.
//
// Run with:  npm test
//
// Gender is normalised on read instead of migrated, so every division saved
// before the three-choice dropdown existed still has its old spelling in the
// settings blob. That mapping is the whole contract: get it wrong and a
// women's division silently reads as open to anyone, or the scheduler stops
// recognising which draws to run last. So the legacy values are asserted by
// name rather than by whatever the current normaliser happens to do.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  normalizeGender,
  isOpenToAnyone,
  normalizeAgeLimit,
  ageLimitLabel,
} from './divisionEligibility.ts';

describe('normalizeGender', () => {
  it('keeps the two gendered values', () => {
    assert.equal(normalizeGender('Men'), 'Men');
    assert.equal(normalizeGender('Women'), 'Women');
  });

  it('maps the legacy spellings of the gendered values', () => {
    assert.equal(normalizeGender('Men Only'), 'Men');
    assert.equal(normalizeGender('Women Only'), 'Women');
    // "Women" must not be read as "Men" by a careless substring match.
    assert.equal(normalizeGender('women only'), 'Women');
  });

  it('reads every legacy open value as Anyone', () => {
    assert.equal(normalizeGender('Mixed'), 'Anyone');
    assert.equal(normalizeGender('Mixed / Co-Ed'), 'Anyone');
    assert.equal(normalizeGender('Open'), 'Anyone');
  });

  it('reads Youth as Anyone — it said nothing about gender', () => {
    assert.equal(normalizeGender('Youth'), 'Anyone');
    assert.equal(normalizeGender('Youth / Under-18'), 'Anyone');
  });

  it('falls back to Anyone for anything unset or unrecognised', () => {
    assert.equal(normalizeGender(undefined), 'Anyone');
    assert.equal(normalizeGender(null), 'Anyone');
    assert.equal(normalizeGender(''), 'Anyone');
    assert.equal(normalizeGender(42), 'Anyone');
  });

  it('ignores surrounding whitespace and case', () => {
    assert.equal(normalizeGender('  MEN  '), 'Men');
  });
});

describe('isOpenToAnyone', () => {
  it('is true for the new word and the old one the scheduler used to match', () => {
    assert.equal(isOpenToAnyone('Anyone'), true);
    assert.equal(isOpenToAnyone('Mixed'), true);
  });

  it('is false for the gendered divisions', () => {
    assert.equal(isOpenToAnyone('Men'), false);
    assert.equal(isOpenToAnyone('Women Only'), false);
  });
});

describe('normalizeAgeLimit', () => {
  it('keeps the offered caps', () => {
    assert.equal(normalizeAgeLimit('U12'), 'U12');
    assert.equal(normalizeAgeLimit('U18'), 'U18');
  });

  it('reads anything unset or unrecognised as no limit', () => {
    assert.equal(normalizeAgeLimit(undefined), '');
    assert.equal(normalizeAgeLimit('U15'), '');
    assert.equal(normalizeAgeLimit(16), '');
  });
});

describe('ageLimitLabel', () => {
  it('spells the cap out', () => {
    assert.equal(ageLimitLabel('U16'), 'Under 16');
  });

  it('names the empty case rather than showing nothing', () => {
    assert.equal(ageLimitLabel(''), 'No limit');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConsent,
  serializeConsent,
  allowsCategory,
  readCookie,
  CONSENT_VERSION,
} from './consent.ts';

describe('parseConsent', () => {
  it('reads a well-formed record', () => {
    assert.deepEqual(parseConsent(`accepted:${CONSENT_VERSION}`), {
      decision: 'accepted',
      version: CONSENT_VERSION,
    });
    assert.deepEqual(parseConsent(`rejected:${CONSENT_VERSION}`), {
      decision: 'rejected',
      version: CONSENT_VERSION,
    });
  });

  it('treats a missing cookie as no answer', () => {
    assert.equal(parseConsent(null), null);
    assert.equal(parseConsent(undefined), null);
    assert.equal(parseConsent(''), null);
  });

  /* The security-relevant case: garbage must never resolve to "accepted". */
  it('rejects values it cannot read confidently', () => {
    assert.equal(parseConsent('yes'), null);
    assert.equal(parseConsent('accepted'), null);
    assert.equal(parseConsent('accepted:'), null);
    assert.equal(parseConsent('accepted:abc'), null);
    assert.equal(parseConsent('accepted:0'), null);
    assert.equal(parseConsent('ACCEPTED:1'), null);
  });

  it('re-asks when the banner version has moved on', () => {
    assert.equal(parseConsent(`accepted:${CONSENT_VERSION + 1}`), null);
    assert.equal(parseConsent(`accepted:${CONSENT_VERSION - 1}`), null);
  });
});

describe('serializeConsent', () => {
  it('round-trips through parseConsent', () => {
    const record = parseConsent(serializeConsent('accepted'));
    assert.equal(record?.decision, 'accepted');
    assert.equal(record?.version, CONSENT_VERSION);
  });
});

describe('allowsCategory', () => {
  it('allows only an explicit acceptance', () => {
    assert.equal(allowsCategory({ decision: 'accepted', version: CONSENT_VERSION }, 'analytics'), true);
  });

  it('denies rejection and silence alike', () => {
    assert.equal(allowsCategory({ decision: 'rejected', version: CONSENT_VERSION }, 'analytics'), false);
    assert.equal(allowsCategory(null, 'analytics'), false);
  });
});

describe('readCookie', () => {
  it('finds a cookie among its neighbours', () => {
    const jar = 'sb-abc-auth-token=xyz; lb_consent=accepted%3A1; other=1';
    assert.equal(readCookie(jar, 'lb_consent'), 'accepted:1');
  });

  it('returns null when absent', () => {
    assert.equal(readCookie('other=1', 'lb_consent'), null);
    assert.equal(readCookie('', 'lb_consent'), null);
  });

  /* A prefix match would make `xx_lb_consent` answer for `lb_consent`. */
  it('does not match a cookie whose name merely ends the same way', () => {
    assert.equal(readCookie('xx_lb_consent=accepted%3A1', 'lb_consent'), null);
  });
});

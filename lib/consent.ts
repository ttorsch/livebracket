/* Cookie consent state.
 *
 * The site sets exactly one cookie today — the Supabase auth token — and
 * that one is strictly necessary, so it needs no permission from anybody.
 * The banner therefore is not gating anything at the moment it ships. It
 * exists so that the day something non-essential arrives (analytics is the
 * obvious candidate), there is already a recorded answer to consult and a
 * visitor who has been asked, rather than a scramble to retrofit consent
 * onto people who were never given the choice.
 *
 * Read that as the rule for anyone adding a script later: ask
 * `hasConsent('analytics')` BEFORE loading it, not after. A tag that loads
 * and then checks has already phoned home.
 *
 * The answer lives in a first-party cookie rather than localStorage on
 * purpose: a cookie is readable during the server render, so the banner can
 * be withheld from a visitor who already answered without a flash of it
 * appearing and vanishing on hydration.
 */

export const CONSENT_COOKIE = 'lb_consent';

/* Six months. Long enough not to nag, short enough that the answer is a
 * current one — the EDPB's guidance is that consent should be refreshed
 * roughly this often, and a "reject" that lasted forever would be a way of
 * never asking again after adding something new. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/* The category a future script belongs to. 'necessary' is not listed
 * because it is not a choice: the auth cookie is required for the site to
 * function and is exempt from consent under both GDPR (ePrivacy art. 5(3))
 * and Thailand's PDPA. */
export type ConsentCategory = 'analytics';

export type ConsentDecision = 'accepted' | 'rejected';

export type ConsentRecord = {
  decision: ConsentDecision;
  /* Version of the wording the visitor agreed to. Bumping CONSENT_VERSION
   * re-asks everyone, which is what you want when the categories change —
   * consent to the 2026 banner is not consent to whatever replaces it. */
  version: number;
};

export const CONSENT_VERSION = 1;

/* Parsing is split out from the cookie jar so it can be tested without a
 * document, and so a malformed or hand-edited value degrades to "never
 * answered" (re-ask) rather than to a silent "accepted". Anything we cannot
 * read confidently is treated as no answer at all. */
export function parseConsent(raw: string | null | undefined): ConsentRecord | null {
  if (!raw) return null;

  const [decision, versionText] = raw.split(':');
  if (decision !== 'accepted' && decision !== 'rejected') return null;

  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) return null;

  /* An answer to an older banner is not an answer to this one. */
  if (version !== CONSENT_VERSION) return null;

  return { decision, version };
}

export function serializeConsent(decision: ConsentDecision): string {
  return `${decision}:${CONSENT_VERSION}`;
}

/* Whether a given category may load. Only an explicit "accepted" is a yes:
 * no answer, a stale answer and a rejection all mean no. Consent is opt-in,
 * so silence must never read as permission. */
export function allowsCategory(
  record: ConsentRecord | null,
  category: ConsentCategory
): boolean {
  if (record?.decision !== 'accepted') return false;

  /* One category today, and a blanket "accepted" covers it. When a second
   * one arrives this is the place that has to stop saying yes to
   * everything — split the record into per-category grants here rather
   * than at the call sites, which should keep asking this one question. */
  return category === 'analytics';
}

/* Pull one cookie out of a `document.cookie`-style string. Kept pure and
 * exported for the tests; the browser helpers below wrap it. */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const value = trimmed.slice(name.length + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      /* A value that is not valid percent-encoding was not written by us. */
      return null;
    }
  }
  return null;
}

/* ── Browser helpers ──────────────────────────────────────────── */

export function getConsent(): ConsentRecord | null {
  if (typeof document === 'undefined') return null;
  return parseConsent(readCookie(document.cookie, CONSENT_COOKIE));
}

export function hasConsent(category: ConsentCategory): boolean {
  return allowsCategory(getConsent(), category);
}

export function setConsent(decision: ConsentDecision): void {
  if (typeof document === 'undefined') return;

  /* Lax, not None: nothing here is needed on a cross-site request, and a
   * consent record is exactly the sort of thing that should not ride along
   * with one. Secure is skipped on plain http so the banner still works on
   * a LAN device during development — production is https, where it sticks. */
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(decision))}` +
    `; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

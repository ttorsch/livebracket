/* ── Who a division is for ────────────────────────────────────────
 *
 * Two things the organizer sets on a division, both advertised rather
 * than enforced: nothing collects a date of birth or checks a player's
 * gender at registration, so these say what the division is for and the
 * organizer polices it.
 *
 * Gender was once a free string tucked into the setup dialog's Advanced
 * panel, with "Mixed / Co-Ed", "Open" and "Youth / Under-18" among its
 * values. It is now one of three choices on the first step, and the old
 * values are normalised on read rather than migrated — anything not
 * explicitly men's or women's was open to everyone, which is what Anyone
 * means. "Youth" said something about age, not gender, so a legacy Youth
 * division reads as Anyone with no age limit until someone sets one.
 *
 * Normalising on read is why this lives here and not in the setup page:
 * the public page and the schedule generator read the same settings blob,
 * and a rule written twice is a rule that drifts.
 */

export type DivisionGender = 'Men' | 'Women' | 'Anyone';

export const DIVISION_GENDERS: DivisionGender[] = ['Men', 'Women', 'Anyone'];

export function normalizeGender(v: unknown): DivisionGender {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s.startsWith('women')) return 'Women';
  if (s.startsWith('men')) return 'Men';
  return 'Anyone';
}

/** Anyone-eligible divisions usually draw players out of the gendered
 *  draws, so the scheduler runs them last. Covers the legacy spellings
 *  ("Mixed", "Co-Ed", "Open") that mean the same thing. */
export function isOpenToAnyone(v: unknown): boolean {
  return normalizeGender(v) === 'Anyone';
}

/** Youth divisions cap the age of the players; '' is the default, no cap. */
export const AGE_LIMITS = ['', 'U12', 'U14', 'U16', 'U18'] as const;

export type AgeLimit = (typeof AGE_LIMITS)[number];

export function ageLimitLabel(v: AgeLimit): string {
  return v ? `Under ${v.slice(1)}` : 'No limit';
}

export function normalizeAgeLimit(v: unknown): AgeLimit {
  return (AGE_LIMITS as readonly unknown[]).includes(v) ? (v as AgeLimit) : '';
}

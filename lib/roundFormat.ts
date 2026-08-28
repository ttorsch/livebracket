/* The round formats, and what to call them.
 *
 * One list, because there were two and they disagreed. The public
 * tournament page kept its own map keyed 'single-elim' / 'double-elim',
 * which are values the database cannot hold: rounds.format is
 * constrained to 'pool' | 'round-robin' | 'single' | 'double' (migration
 * 0001). Every lookup for a knockout round therefore missed and fell
 * through to the raw column value, which is why a Single Elimination
 * round rendered as the word "single".
 *
 * Kept free of imports so the organizer's setup page, the public page
 * and anything server-side can all share it. */

export type RoundFormat = 'pool' | 'round-robin' | 'single' | 'double';

export const ROUND_FORMAT_LABEL: Record<RoundFormat, string> = {
  pool: 'Pool Play',
  'round-robin': 'Round Robin',
  single: 'Single Elimination',
  double: 'Double Elimination',
};

/* Falls back to the raw value rather than throwing: an unrecognised
 * format is a display problem, not a reason to blank the page. It should
 * be impossible now that the keys match the schema. */
export function roundFormatLabel(format: string): string {
  return ROUND_FORMAT_LABEL[format as RoundFormat] ?? format;
}

/* A round that ranks teams against each other rather than knocking them
 * out — the only kind that produces a standings table. */
export function isGroupFormat(format: string): boolean {
  return format === 'round-robin' || format === 'pool';
}

/* A round teams get knocked out of, and so the only kind that has a
 * seeding/crossing rule. */
export function isKnockoutFormat(format: string): boolean {
  return format === 'single' || format === 'double';
}

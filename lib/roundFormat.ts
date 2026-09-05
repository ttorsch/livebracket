/* The round formats, and what to call them.
 *
 * One list, because there were two and they disagreed. The public
 * tournament page kept its own map keyed 'single-elim' / 'double-elim',
 * which are values the database cannot hold: rounds.format is
 * constrained to 'round-robin' | 'single' | 'double' (migrations 0001
 * and 0010). Every lookup for a knockout round therefore missed and fell
 * through to the raw column value, which is why a Single Elimination
 * round rendered as the word "single".
 *
 * There was a fourth value, 'pool', labelled "Pool Play". Nothing wrote
 * it: no dropdown offered it and no round ever held it. It survived as a
 * second name for a round robin — and the two names were not treated the
 * same, so a round carrying it would have been scheduled as a knockout.
 * Dropped in 0010; see that migration.
 *
 * Whether a round robin is "pool play" is not a property of the format
 * at all: it is the pool count on the draw. One pool is a round robin,
 * four pools is pool play, and both are this one format.
 *
 * Kept free of imports so the organizer's setup page, the public page
 * and anything server-side can all share it. */

export type RoundFormat = 'round-robin' | 'single' | 'double';

export const ROUND_FORMAT_LABEL: Record<RoundFormat, string> = {
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
 * out — the only kind that produces a standings table, and the only kind
 * played in pools.
 *
 * Ask this rather than comparing to 'round-robin' by hand. Six places
 * used to make the comparison themselves and they did not all agree,
 * which is the whole of the bug 0010 closes. There is one group format
 * today; if a second is ever added, this is the only line that needs to
 * hear about it. */
export function isGroupFormat(format: string): boolean {
  return format === 'round-robin';
}

/* A round teams get knocked out of, and so the only kind that has a
 * seeding/crossing rule. */
export function isKnockoutFormat(format: string): boolean {
  return format === 'single' || format === 'double';
}

/** Points awarded in group/round-robin standings tables. */
export const STANDING_POINTS = {
  WIN: 2,     // Match won (2–0 or 2–1)
  LOSS: 1,    // Match lost (1–2 or 0–2, completed)
  FORFEIT: 0, // Forfeit / Default / Bye (0 points)
} as const;

/**
 * Checks whether a completed match is a Forfeit / Default (Bye).
 * Defined as a 2–0 win with sets of 21–0, 21–0 (or where the losing side
 * scored 0 points in all sets).
 */
export function isForfeitMatch(
  scoreWinner: number[] | null | undefined,
  scoreLoser: number[] | null | undefined,
): boolean {
  if (!scoreWinner || !scoreLoser || scoreWinner.length === 0 || scoreLoser.length === 0) return false;
  const loserTotal = scoreLoser.reduce((sum, p) => sum + (typeof p === 'number' ? p : 0), 0);
  const winnerTotal = scoreWinner.reduce((sum, p) => sum + (typeof p === 'number' ? p : 0), 0);
  return loserTotal === 0 && winnerTotal > 0;
}


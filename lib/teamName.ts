/* ── Team display names ───────────────────────────────────────────
 *
 * A team reads as its players joined on a slash, with no spaces around
 * it: "Intharat/Somboon".
 *
 * The join lives here rather than at each call site because the same
 * string is also persisted on teams.name at registration, and rows
 * written before the format settled still carry the spaced form. Reads
 * normalize rather than trusting whatever Postgres hands back, so old
 * and new rows render identically without a data migration.
 */

const SEPARATOR = '/';

/** Build a team name from its players. */
export function joinTeamName(names: (string | null | undefined)[]): string {
  return names.map(n => (n ?? '').trim()).filter(Boolean).join(SEPARATOR);
}

/** Normalize a stored team name to the display format. Idempotent, and a
 *  no-op for names that aren't player pairs ("TBD", "BYE", a club name). */
export function formatTeamName<T extends string | null | undefined>(name: T): T {
  if (!name) return name;
  return joinTeamName(name.split(SEPARATOR)) as T;
}

/**
 * Format a team name for compact views (like pool draw results and standings):
 * - If there is a team name (no '/'), show the full team name (e.g. "Sun Chasers").
 * - If there is no team name (player names joined by '/'), show player first name / player first name (e.g. "Ananda/Mali").
 */
export function formatTeamFirstName(name: string | null | undefined): string {
  if (!name) return '';
  const players = name.split(SEPARATOR).map(p => p.trim()).filter(Boolean);
  if (players.length <= 1) return name;
  const firstNames = players.map(p => {
    const parts = p.split(/\s+/).filter(Boolean);
    return parts[0] || p;
  });
  return firstNames.join(SEPARATOR);
}

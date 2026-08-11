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

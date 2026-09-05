/* ── Team display names ───────────────────────────────────────────
 *
 * Teams are strictly represented by their players' first names joined on
 * a slash with spaces: "Ananda / Mali".
 *
 * Custom team names, clubs, and hometowns are never displayed to represent
 * a team anywhere on the website. If only a legacy custom name exists without
 * player details, it falls back to "Seed X" or "Player TBD".
 */

export const SEPARATOR = ' / ';

/* What formatPlayerNames yields when there is nothing to name at all: an
 * empty knockout slot has no players, no stored name and no seed, so it
 * falls through to this. It is a display string, not a team — callers that
 * can say something better about an empty slot (a crossing slot reading
 * "#1 Pool A", a feeder reading "Winner of M12") have to recognise it as
 * "not filled yet" rather than as a team named "Player TBD".
 * See lib/divisionMatches.labelDivisionMatches, which is where mistaking
 * the two hid every crossing label behind this string. */
export const UNNAMED_TEAM = 'Player TBD';

export function isUnnamedTeam(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return trimmed === '' || trimmed.toUpperCase() === 'TBD' || trimmed === UNNAMED_TEAM;
}

/** Extract the first name from a player's full name (e.g. "Ananda Suwan" -> "Ananda"). */
export function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts[0] || trimmed;
}

/** Join player first names with slash: "Ananda / Mali". */
export function joinPlayerFirstNames(names: (string | null | undefined)[]): string {
  return names
    .map(n => extractFirstName(n))
    .filter(Boolean)
    .join(SEPARATOR);
}

/** Build a stored team name from its players. */
export function joinTeamName(names: (string | null | undefined)[]): string {
  return names.map(n => (n ?? '').trim()).filter(Boolean).join('/');
}

/**
 * Format player names to represent a team across the website.
 * Always shows player's first names only, joined by " / " (e.g. "Ananda / Mali").
 * Never shows custom team names, club, or hometown.
 * If only old custom team name exists without players, falls back to "Seed X" or "Player TBD".
 */
export function formatPlayerNames(
  players?: Array<{ name?: string | null }> | null,
  rawName?: string | null,
  seed?: number | null,
): string {
  // 1. If player objects are provided with non-empty names
  if (players && players.length > 0) {
    const valid = players.map(p => p?.name).filter(Boolean) as string[];
    if (valid.length > 0) {
      return joinPlayerFirstNames(valid);
    }
  }

  // 2. If rawName is provided
  if (rawName) {
    const trimmed = rawName.trim();
    if (!trimmed) return seed != null ? `Seed ${seed}` : 'Player TBD';

    const upper = trimmed.toUpperCase();
    if (upper === 'BYE') return 'BYE';
    if (upper === 'TBD') return 'TBD';
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('Winner of') ||
      trimmed.startsWith('Loser of') ||
      trimmed.startsWith('Pool ')
    ) {
      return trimmed;
    }

    // Check if rawName is slash-separated player names (e.g. "Ananda Suwan/Mali Sunthorn" or "Ananda / Mali")
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        return joinPlayerFirstNames(parts);
      }
    }

    // If it was a single name that looks like an old custom team or club name (e.g. "Sun Chasers"):
    // Per requirement: strictly never show old team/club names!
    return seed != null ? `Seed ${seed}` : 'Player TBD';
  }

  return seed != null ? `Seed ${seed}` : 'Player TBD';
}

/**
 * Normalize a stored team name to the display format (player first names).
 * Never displays custom team names or club names.
 */
export function formatTeamName<T extends string | null | undefined>(name: T, seed?: number | null): T {
  if (!name) return name;
  return formatPlayerNames(null, name, seed) as T;
}

/**
 * Format a team name for views (like pool draw results and standings):
 * Returns player first name / player first name (e.g. "Ananda / Mali").
 * Never displays custom team names or club names.
 */
export function formatTeamFirstName(name: string | null | undefined, seed?: number | null): string {
  if (!name) return '';
  return formatPlayerNames(null, name, seed);
}

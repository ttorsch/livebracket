/* ── What makes a typed-in result a result ───────────────────────
 *
 * The referee's screen builds a score point by point, so it can never
 * produce a set nobody won. An organizer typing a result into the schedule
 * can: half a column filled, a 15–15 set, a match tied at one set each.
 *
 * The same rules therefore have to be read twice — once by the cells on
 * the card, so the organizer is told before they leave the field, and once
 * by the route, because a client is not a validator. This is that one
 * reader.
 *
 * Pure and dependency-free on purpose, like ./setCompletion: the schedule
 * page is a client component and `lib/scorekeeper.ts` pulls in Supabase and
 * Redis, so the rule lives where both sides — and `npm test` — can reach it.
 */

export interface SetScore {
  a: number;
  b: number;
}

/* How many sets each side has won, by the only rule that matters for a
 * completed set: more points than the other side. */
export function setWins(sets: SetScore[]) {
  return {
    a: sets.filter(s => s.a > s.b).length,
    b: sets.filter(s => s.b > s.a).length,
  };
}

/** No sane match runs longer than this; the cap is what keeps a hostile or
 *  bugged caller from writing a thousand-element array into the row. */
export const MAX_SETS = 5;

/** A point total, kept to something a volleyball set could actually reach.
 *  Anything that isn't a non-negative whole number reads as 0. */
function clampPoints(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(999, Math.trunc(v));
}

/** Whatever arrived over the wire, as at most MAX_SETS pairs of numbers. */
export function cleanSets(raw: unknown): SetScore[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SETS).map(item => {
    const s = (item ?? {}) as { a?: unknown; b?: unknown };
    return { a: clampPoints(s.a), b: clampPoints(s.b) };
  });
}

/* Why this result cannot be stored, in the words the organizer sees — or
 * null when it can.
 *
 * An empty list is deliberately fine: clearing every set is how a result
 * entered by mistake is taken back off the bracket.
 */
export function scoreProblem(sets: SetScore[]): string | null {
  if (sets.length === 0) return null;
  if (sets.length > MAX_SETS) return `A match can have at most ${MAX_SETS} sets.`;

  // A drawn set can't decide a match, and silently storing one would produce
  // a result nobody can explain later.
  if (sets.some(s => s.a === s.b)) {
    return 'Every set needs a winner — one side must have more points.';
  }

  const wins = setWins(sets);
  if (wins.a === wins.b) {
    return 'The match is tied on sets — add a deciding set.';
  }
  return null;
}

/** Which side won, once `scoreProblem` has passed. Null for a cleared score. */
export function scoreWinner(sets: SetScore[]): 'A' | 'B' | null {
  if (sets.length === 0) return null;
  const wins = setWins(sets);
  if (wins.a === wins.b) return null;
  return wins.a > wins.b ? 'A' : 'B';
}

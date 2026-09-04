/* ── When is a set won? ───────────────────────────────────────────
 *
 * The organizer picks the format in division setup (Format & Rules), it is
 * stored per round in `scoring_rules`, and this is the one place that turns
 * those numbers into an answer. The referee should never have to remember
 * whether this division plays to 21 or 25, or whether the third set is short.
 *
 * Pure and dependency-free on purpose: the scorekeeper screen is a client
 * component and `lib/scorekeeper.ts` pulls in Supabase and Redis, so the rule
 * lives here where both sides — and `npm test` — can reach it.
 */

export interface ScoringRules {
  setsBestOf: number;        // best of 1 / 3 / 5
  pointsPerSet: number;      // target for the ordinary sets
  winBy2: boolean;           // must win by two
  hardCap: number;           // ceiling that ends a deuce (0 = none)
  decidingSetPoints: number; // target for the deciding set
}

/* The last set of the format is the deciding set and usually plays short —
 * 15 rather than 21. Best-of-one has no deciding set: its single set is an
 * ordinary one, which is why setup greys the field out at that format.
 *
 * `setIndex` is zero-based: set 1 on the board is index 0. */
export function setTarget(setIndex: number, rules: ScoringRules): number {
  const isDeciding = rules.setsBestOf > 1 && setIndex === rules.setsBestOf - 1;
  return isDeciding ? rules.decidingSetPoints : rules.pointsPerSet;
}

/* Whether the set on the board is over.
 *
 * A target of 0 means the organizer left the field blank, and the honest
 * reading of that is "no automatic target" — the set simply never closes on
 * its own rather than closing at some number nobody chose. */
export function isSetComplete(
  a: number,
  b: number,
  setIndex: number,
  rules: ScoringRules
): boolean {
  const target = setTarget(setIndex, rules);
  if (!(target > 0)) return false;

  const lead = Math.max(a, b);
  const trail = Math.min(a, b);
  if (lead === trail) return false; // a drawn score is never a won set

  if (!rules.winBy2) return lead >= target;

  /* The hard cap is what stops a deuce running forever: at the cap the next
   * point takes the set on a one-point lead. Guarded against a cap set below
   * the target, which would otherwise end sets early. */
  if (rules.hardCap > 0 && lead >= Math.max(rules.hardCap, target)) return true;

  return lead >= target && lead - trail >= 2;
}

/* Which side won a completed set — by the only rule that decides one. */
export function setWinner(a: number, b: number): 'a' | 'b' | null {
  if (a > b) return 'a';
  if (b > a) return 'b';
  return null;
}

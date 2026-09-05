/* ── What the round's own format says a set has to be ──────────────
 *
 * lib/matchScore answers the format-independent questions: a set needs a
 * winner, a match cannot finish level. Those hold for every division.
 *
 * This answers the questions only the round can answer, from the
 * scoring_rules it already stores:
 *
 *   { setsBestOf: 3, pointsPerSet: 15, decidingSetPoints: 11,
 *     winBy2: true, hardCap: 0 }
 *
 * — the "15-15-11" the organizer picked at setup. A set won 12–10 in that
 * format is not a short set, it is not a set at all, and the organizer
 * should be told so while they are still looking at the cells rather than
 * after a bracket has been built on it.
 *
 * Deliberately pure and import-free, like ./matchScore: the schedule page
 * is a client component and the API route needs the same answers, so the
 * rule has to live somewhere both — and `npm test` — can reach.
 */

export interface ScoringRules {
  /** Most sets the match can run to. A best-of-3 never has a fourth. */
  setsBestOf: number;
  /** Target for every set but the last possible one. */
  pointsPerSet: number;
  /** Target for the last possible set, which is usually shorter. */
  decidingSetPoints: number;
  /** Whether a set has to be won by a clear two points. */
  winBy2: boolean;
  /** Score at which win-by-two stops applying. 0 means there is no cap. */
  hardCap: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  setsBestOf: 3,
  pointsPerSet: 21,
  decidingSetPoints: 15,
  winBy2: true,
  hardCap: 0,
};

function posInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** The stored blob as rules, with a sane format standing in for anything
 *  missing — an un-migrated or hand-edited round must not break scoring. */
export function readScoringRules(raw: unknown): ScoringRules {
  const r = (raw ?? {}) as Record<string, unknown>;
  const capRaw = typeof r.hardCap === 'number' ? r.hardCap : Number(r.hardCap);
  return {
    setsBestOf: posInt(r.setsBestOf, DEFAULT_SCORING_RULES.setsBestOf),
    pointsPerSet: posInt(r.pointsPerSet, DEFAULT_SCORING_RULES.pointsPerSet),
    decidingSetPoints: posInt(r.decidingSetPoints, DEFAULT_SCORING_RULES.decidingSetPoints),
    winBy2: r.winBy2 === undefined ? DEFAULT_SCORING_RULES.winBy2 : !!r.winBy2,
    hardCap: Number.isFinite(capRaw) && capRaw > 0 ? Math.trunc(capRaw) : 0,
  };
}

/** Sets one side must take to win the match: 2 of 3, 3 of 5, 1 of 1. */
export function setsToWin(rules: ScoringRules): number {
  return Math.floor(rules.setsBestOf / 2) + 1;
}

/** The target for set `index` (0-based). The last possible set is the
 *  deciding one and is usually played to fewer points. */
export function targetForSet(rules: ScoringRules, index: number): number {
  return index === rules.setsBestOf - 1 ? rules.decidingSetPoints : rules.pointsPerSet;
}

/** Sets each side has taken. A drawn set counts for neither. */
export function setWinsOf(sets: { a: number; b: number }[]) {
  return {
    a: sets.filter(s => s.a > s.b).length,
    b: sets.filter(s => s.b > s.a).length,
  };
}

/** True once one side has taken the match and no further set can be played. */
export function matchDecided(rules: ScoringRules, sets: { a: number; b: number }[]): boolean {
  const wins = setWinsOf(sets);
  const need = setsToWin(rules);
  return wins.a >= need || wins.b >= need;
}

/* How many set columns to offer: the ones played, plus one to type the next
 * into — but never past the best-of, and never once the match is already
 * won. A 2–0 in a best-of-3 gets no third column, because there is no third
 * set to record. */
export function visibleSetCount(
  rules: ScoringRules,
  sets: { a: number; b: number }[],
  playedColumns: number,
): number {
  const played = Math.min(playedColumns, rules.setsBestOf);
  if (matchDecided(rules, sets.slice(0, played))) return played;
  return Math.min(rules.setsBestOf, played + 1);
}

/** Why set `index` is not a legal set in this format, or null. */
export function setProblem(
  rules: ScoringRules,
  index: number,
  set: { a: number; b: number },
): string | null {
  const target = targetForSet(rules, index);
  const hi = Math.max(set.a, set.b);
  const lo = Math.min(set.a, set.b);
  const n = index + 1;

  if (set.a === set.b) return `Set ${n} needs a winner — one side must have more points.`;

  // Short of the target is not a set. Over it is fine: that is a deuce.
  if (hi < target) return `Set ${n} is played to ${target} — ${hi} does not win it.`;

  if (rules.hardCap > 0 && hi > rules.hardCap) {
    return `Set ${n} cannot go past the ${rules.hardCap}-point cap.`;
  }

  // At the cap the set ends on a one-point lead, so win-by-two stops there.
  const atCap = rules.hardCap > 0 && hi >= rules.hardCap;
  if (rules.winBy2 && !atCap && hi - lo < 2) {
    return `Set ${n} has to be won by two — ${hi}–${lo} is not finished.`;
  }

  return null;
}

/* Why the whole result cannot be stored, in the organizer's words, or null.
 *
 * An empty list stays legal on purpose: clearing every set is how a result
 * typed in by mistake is taken back off the bracket. */
export function matchScoreProblem(
  rules: ScoringRules,
  sets: { a: number; b: number }[],
): string | null {
  if (sets.length === 0) return null;
  if (sets.length > rules.setsBestOf) {
    return `This round is best of ${rules.setsBestOf} — there cannot be a set ${rules.setsBestOf + 1}.`;
  }

  for (let i = 0; i < sets.length; i++) {
    const problem = setProblem(rules, i, sets[i]);
    if (problem) return problem;
  }

  // A set played after the match was already won is not a set that happened.
  const need = setsToWin(rules);
  for (let i = 0; i < sets.length - 1; i++) {
    const wins = setWinsOf(sets.slice(0, i + 1));
    if (wins.a >= need || wins.b >= need) {
      return `The match was won after set ${i + 1} — set ${i + 2} cannot be played.`;
    }
  }

  const wins = setWinsOf(sets);
  if (wins.a < need && wins.b < need) {
    return sets.length >= rules.setsBestOf
      ? 'Neither side has won enough sets to take the match.'
      : 'The match is not finished — add the deciding set.';
  }

  return null;
}

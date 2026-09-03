/* ── The handover: a drawn bracket becomes the solver's input ──────────
 *
 * Everything the generator knows about a tournament arrives through this
 * one function. On one side is the bracket as the database holds it —
 * rounds with a format, matches with team ids. On the other is the flat,
 * self-describing shape the solver reasons about, in which a match already
 * knows whether it is pool play, which pool, how long it runs, and what has
 * to finish before it can start.
 *
 * It lived inside the schedule screen's render, mixed in with the code that
 * draws the grid, and nothing checked it. That is where the "Pool Play is
 * not pool play" bug lived: a single mis-derived boolean here silently
 * reshapes every later phase — the pool rotation, the court appetite, the
 * staging waves, and which rest rule a match is placed under — and none of
 * those phases can tell that the fact they were handed was wrong. Out here
 * it is a pure function over plain data, so it can be checked directly.
 *
 * Three things are derived rather than copied, and each is derived here
 * because the solver cannot work it out for itself:
 *
 *   isPool  — asked of the shared format predicate, never by comparing the
 *             format string by hand. See lib/roundFormat.
 *   pool    — pool membership is never stored on a match; it comes from the
 *             seeds, via the same labelling the bracket and the match list
 *             read, so all three agree about which pool a match is in.
 *   thirdPlace/dependsOn — the play-off for 3rd is drawn from two *losing*
 *             semifinals and played before the final, so round order is no
 *             guide to its dependencies. They are stated outright.
 *
 * Byes are dropped: a bye is settled before it starts, so it is never
 * played and must not hold a court.
 */

import type { DetailDivision } from '../data.ts';
import { labelDivisionMatches, loserFeedersOf, type MatchLabel } from '../divisionMatches.ts';
import { isGroupFormat } from '../roundFormat.ts';
import type { SchedulableDivision, SchedulableMatch } from './types.ts';

/** Match labels for every division, keyed by division id then match id —
 *  the shape the schedule screen already memoises. */
export type LabelsByDivision = Map<string, Map<string, MatchLabel>>;

/** Court-affinity overrides the organizer has typed but not yet saved,
 *  keyed by division id. A `null` means "no override", not "zero". */
export type CourtOverrides = Record<string, number | null>;

/** Labels for a set of divisions, from the one place that decides them.
 *  Callers that already hold this map should pass their own rather than
 *  building a second one — two labellings of the same division would be
 *  two answers to "which pool is this match in". */
export function labelDivisions(divisions: DetailDivision[]): LabelsByDivision {
  return new Map(divisions.map(d => [d.id, labelDivisionMatches(d)]));
}

export function toSchedulableDivisions(
  divisions: DetailDivision[],
  labels: LabelsByDivision,
  overrides: CourtOverrides = {},
): SchedulableDivision[] {
  return divisions.map(division => {
    const divisionLabels = labels.get(division.id);
    const losers = loserFeedersOf(division);

    const matches: SchedulableMatch[] = division.bracket.flatMap((round, roundIndex) => {
      const isPool = isGroupFormat(round.format);

      return round.matches
        .filter(m => !divisionLabels?.get(m.id)?.bye)
        .map((m): SchedulableMatch => ({
          id: m.id,
          teamA: m.teamAId,
          teamB: m.teamBId,
          isPool,
          pool: divisionLabels?.get(m.id)?.pool ?? null,
          durationMinutes: round.durationMinutes, // per-round slot length declared in setup
          roundIndex,                             // bracket is setup-round order; 0 = opening round
          ...(losers[m.id] ? { isThirdPlace: true, dependsOn: losers[m.id] } : {}),
        }));
    });

    return {
      id: division.id,
      label: division.label,
      /* No draw yet means no pool count yet, and one pool is the honest
         reading: an undrawn division is one undivided field of teams. */
      pools: division.drawConfig?.pools ?? 1,
      netHeight: division.netHeight,
      gender: division.gender,
      /* An unsaved override wins over the saved value; neither means the
         generator derives the court count itself. */
      dedicatedCourts: overrides[division.id] ?? division.dedicatedCourts ?? null,
      matches,
    };
  });
}

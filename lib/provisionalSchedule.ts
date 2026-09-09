/* ── The provisional schedule ─────────────────────────────────────────
 *
 * A whole tournament's play plan, derived before anything has been drawn.
 *
 * Nothing here is stored. The generator is pure and deterministic — its own
 * header says the same input always produces the same schedule — and every
 * input is already persisted: the division caps, pool counts, advance rules
 * and round lists from setup, and the courts, day windows and lunch from
 * schedule_config. So the organizer and the public compute the same plan
 * from the same rows, and there is nothing to save, nothing to publish out
 * of date, and nothing a later draw can orphan.
 *
 * That is the whole reason this does not write placements. A saved
 * provisional schedule would be a second copy of a derivable fact, and the
 * copy would be the one that went stale.
 */

import type { TournamentDetail, DetailDivision } from './data.ts';
import { provisionalDivision, isUndrawn, isDrawn } from './provisionalDraw.ts';
import { labelDivisions, toSchedulableDivisions } from './schedule/schedulableDivisions.ts';
import { generateSchedule } from './schedule/generate.ts';

/** 'YYYY-MM-DD' plus a whole number of days, in UTC — the same arithmetic the
 *  schedule route uses when it turns a day offset into a stored instant. */
function addDaysUTC(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface ProvisionalSchedule {
  /** The tournament as it would be played, ready for CourtScheduleView. */
  detail: TournamentDetail;
  /** Matches with no room inside the event — the honest part of the answer. */
  overflowCount: number;
  /** Divisions the plan assumes will fill, and to what. */
  assumptions: { label: string; cap: number; pools: number }[];
}

/**
 * The plan for a tournament nothing has been drawn for yet, or null.
 *
 * Null once *any* division has real matches: from that moment the drawn
 * bracket is the truth, and a projection laid over it would be strictly worse
 * information than the thing it was covering.
 */
export function provisionalSchedule(detail: TournamentDetail | null): ProvisionalSchedule | null {
  if (!detail || !isUndrawn(detail.divisions)) return null;

  const divisions: DetailDivision[] = detail.divisions.map(d =>
    provisionalDivision(d, { pools: d.plannedPools, thirdPlace: d.plannedThirdPlace }),
  );
  /* Nothing to derive — every division is capless, formatless, or both, so
     each came back with the configured-but-empty rounds it went in with.
     Counted by matches for the same reason isUndrawn is. */
  if (!divisions.some(isDrawn)) return null;

  const labels = labelDivisions(divisions);
  const result = generateSchedule(
    toSchedulableDivisions(divisions, labels),
    detail.scheduleConfig,
    Math.max(1, detail.dayCount),
  );

  const placed = new Map(result.assignments.map(a => [a.matchId, a]));
  const scheduled: DetailDivision[] = divisions.map(division => ({
    ...division,
    bracket: division.bracket.map(round => ({
      ...round,
      matches: round.matches.map(m => {
        const at = placed.get(m.id);
        if (!at) return m;
        return {
          ...m,
          court: at.court,
          time: at.time,
          scheduledDate: addDaysUTC(detail.startDate, at.day),
        };
      }),
    })),
  }));

  return {
    detail: { ...detail, divisions: scheduled },
    overflowCount: result.overflow.length,
    assumptions: divisions
      .filter(isDrawn)
      .map(d => ({ label: d.label, cap: d.teams, pools: d.drawConfig?.pools ?? 0 })),
  };
}

/** One sentence naming what the plan took for granted, for the banner.
 *
 *  Said in full rather than summarised: "assumes divisions fill" invites the
 *  reader to assume the numbers are known, and they are not. */
export function provisionalAssumptionText(
  assumptions: ProvisionalSchedule['assumptions'],
): string {
  if (assumptions.length === 0) return '';
  const parts = assumptions.map(a =>
    a.pools > 0
      ? `${a.label} full at ${a.cap} teams in ${a.pools} pools`
      : `${a.label} full at ${a.cap} teams`,
  );
  if (parts.length === 1) return `Assumes ${parts[0]}.`;
  return `Assumes ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}

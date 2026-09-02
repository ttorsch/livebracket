/* ── What counts as a placed match ────────────────────────────────
 *
 * A *placement* is one match's court, day and time. This is the
 * predicate that asks whether a match has one — and it exists as a
 * module because three parts of the schedule page were asking it
 * three different ways, and gave three different answers.
 *
 * The disagreement was about `day`. It is a **signed offset** from the
 * tournament's start date, computed by differencing two real dates, so
 * `-1` means "the day before the event starts" exactly as `1` means
 * "the second day". It is not a sentinel, and reading it as one is
 * what broke:
 *
 * - the calendar grid drew a match on an off-event day (issue 12: the
 *   same reasoning that keeps an *off-roster court* on screen);
 * - the validator filtered on `day >= 0` and checked none of them, so
 *   an off-event section was drawn with no court clash, no team clash
 *   and no dependency check looking at it;
 * - the save path read `day < 0` as "unscheduled" and wrote `court:
 *   null`, so saving *deleted* the placement it was drawing.
 *
 * A match with no placement is a different state entirely, and it is
 * marked by having **no date**, not by the sign of an integer: the
 * `Unscheduled` tray is dateless (issue 17), and so is an *overflow*
 * the generator could not fit. So the date is the question asked here,
 * and `day` is only ever read once the answer is yes.
 *
 * See .scratch/schedule-generator/issues/19-validate-off-event-days.md
 */

/** The parts of a merged schedule row this rule reads. Structural rather
 *  than the page's own row type, so the rule can be tested without one. */
export interface PlaceableMatch {
  /** True when the row carries no court or no time at all. */
  unscheduled?: boolean;
  /** 'YYYY-MM-DD' the match sits on; '' when it sits on no date. */
  date: string;
  /** 'HH:MM', or a placeholder when there is no time. */
  time: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether this match has a placement: a court, a real date and a real
 *  time. Everything the grid draws, and nothing else, so the view and
 *  the validator cannot disagree about which matches exist. */
export function hasPlacement(m: PlaceableMatch): boolean {
  return !m.unscheduled && m.date !== '' && HHMM.test(m.time);
}

/** Whether a day offset falls outside the event's configured days.
 *
 *  Not a fault on the match: it is a property of the *day*, said once
 *  where the day is drawn rather than repeated on every card sitting
 *  on it. `outsideDay` remains a statement about the clock — the
 *  playing hours — which is a different axis and has a different
 *  remedy (move the card, versus move the tournament's dates). */
export function isOffEventDay(day: number, dayCount: number): boolean {
  return day < 0 || day >= dayCount;
}

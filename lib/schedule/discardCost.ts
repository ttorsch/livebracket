// What rebuilding a division's rounds would destroy, and how to say it out loud.
//
// A schedule is not stored beside the matches — it *is* columns on them
// (court, planned_time, scheduled_time, referee_team_id) — and matches.round_id
// cascades on delete. So a redraw does not orphan a division's placements, it
// deletes them, and nothing survives afterwards to report. The only honest
// moment to count them is before the delete, which is what this module is for.
//
// Kept pure and here, rather than inline in the draw route, because the
// number the organizer is shown is a promise about what they are about to
// lose — the kind of claim that should be tested rather than trusted.

/** The subset of a match row that says whether it carries scheduling work. */
export interface PlacementRow {
  court: string | null;
  planned_time: string | null;
  scheduled_time: string | null;
  referee_team_id: string | null;
}

export interface DiscardCost {
  /** Matches holding both a court and a time. */
  placed: number;
  /** Referee duty, assigned by hand and keyed the same way. */
  refereed: number;
}

export const NO_DISCARD_COST: DiscardCost = { placed: 0, refereed: 0 };

/** Tally what a set of match rows would cost to destroy. */
export function tallyDiscardCost(rows: readonly PlacementRow[]): DiscardCost {
  let placed = 0, refereed = 0;
  for (const m of rows) {
    // Mirrors getSetupOverview's rule: a time without a court is not a
    // placement anyone can turn up to. planned_time is the published promise,
    // so it still counts once drift has moved scheduled_time past it.
    if (m.court && (m.planned_time || m.scheduled_time)) placed++;
    if (m.referee_team_id) refereed++;
  }
  return { placed, refereed };
}

/** Nothing here is worth warning anyone about. */
export function isEmptyCost(c: DiscardCost): boolean {
  return c.placed === 0 && c.refereed === 0;
}

/** "46 scheduled matches and 3 referee assignments" — real
 *  counts, never naming a category that is zero, so the sentence stays true
 *  for a division that has times but no referee assignments. */
export function describeDiscardCost(cost: DiscardCost): string {
  const parts: string[] = [];
  if (cost.placed > 0) parts.push(`${cost.placed} scheduled match${cost.placed === 1 ? '' : 'es'}`);
  if (cost.refereed > 0) parts.push(`${cost.refereed} referee assignment${cost.refereed === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

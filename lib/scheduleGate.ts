/* ── The draw-lock gate ───────────────────────────────────────────
 *
 * A schedule may be *generated* freely. A preview is unsaved and
 * organizer-only, so no player ever sees one and no fairness question
 * arises — which is what keeps "does this event fit on six courts?"
 * answerable before the draw is settled.
 *
 * Committing placements is the different act. The schedule is built
 * against match ids, and regenerating an unlocked draw replaces them, so
 * placements saved against a draw that can still move are placements that
 * can be silently orphaned. The draw lock already means exactly the thing
 * the schedule needs — *final, not merely generated* — so it is the
 * precondition, and no new flag is invented to carry it.
 *
 * Two edges are deliberate:
 *
 * - **The whole tournament, not each division.** The day plan balances
 *   divisions against one another and court capacity is shared, so a
 *   schedule covering some divisions is rewritten wholesale when the rest
 *   arrive. Saving it would teach the organizer something false.
 *
 * - **Placements only.** The venue configuration — courts, day times,
 *   lunch, blocked periods — saves whatever the draw is doing. Gating it
 *   too would mean the capacity testing this design set out to protect
 *   could be done but never kept.
 *
 * Every division counts. There is no cancelled division in this schema
 * (only tournaments carry `cancelled_at`), so there is no such exemption
 * to make, and inventing one by proxy — "divisions with matches drawn" —
 * would quietly let an undrawn division fall out of a saved schedule.
 *
 * The one state that is neither open nor a refusal is *nothing drawn at all*.
 * A tournament with no matches anywhere has no placements to write, so
 * refusing them is vacuous — and saying "the draw is not locked, lock it on
 * the bracket page" is worse than vacuous, because there is no draw there to
 * lock. That reads as a job the organizer has failed to do when in fact the
 * only thing left to save is the venue setup, which saves anyway. This is the
 * same reasoning the empty-division case below already applies; it just also
 * holds when the divisions exist and none of them has been drawn.
 *
 * Note this is deliberately *not* keyed on the tournament's phase. An
 * organizer may draw pools while registration is still open, and those
 * placements can be orphaned exactly like any other — so "registration is
 * open" is not a safe proxy for "there is nothing to lose".
 *
 * See .scratch/schedule-generator/issues/09-schedule-generation-preconditions.md
 */

export interface GateDivision {
  id: string;
  /** The division's name, as the organizer reads it. */
  label: string;
  /** settings.draw.isLocked — the draw is final, not merely generated. */
  drawLocked: boolean;
  /** Whether a draw has actually produced matches. The settings key can exist
   *  as a stub before one has run, so it proves nothing on its own. */
  hasMatches: boolean;
}

export interface UnlockedDivision {
  id: string;
  label: string;
}

export interface ScheduleSaveGate {
  /** May placements be written? */
  open: boolean;
  /** The divisions standing in the way, in the order they were given. */
  unlocked: UnlockedDivision[];
  /** Organizer-facing reason. Null when the gate is open, and also when
   *  there is nothing to place — that is not a refusal to explain. */
  reason: string | null;
  /** Nothing has been drawn anywhere, so there are no placements to write.
   *  Closed, but with nothing to report: callers should say what *did* save
   *  rather than warn about a lock the organizer cannot yet apply. */
  nothingToPlace: boolean;
}

/** "A", "A and B", "A, B and C" — names read as a sentence, because this
 *  list is spoken to the organizer rather than enumerated at them. */
function nameList(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Whether the tournament's placements may be saved, and if not, who is
 *  holding it up. Pure: both the button and the route ask this same
 *  question, so a disabled button and a refused request can never disagree
 *  about the reason. */
export function scheduleSaveGate(divisions: GateDivision[]): ScheduleSaveGate {
  /* Nothing drawn anywhere: no placements exist to be written or lost.
     Checked before the lock test so an undrawn tournament is never told to
     go and lock a draw that has not been run. */
  if (!divisions.some(d => d.hasMatches)) {
    return { open: false, unlocked: [], reason: null, nothingToPlace: true };
  }

  const unlocked = divisions
    .filter(d => !d.drawLocked)
    .map(d => ({ id: d.id, label: d.label }));

  // No divisions means no matches, so there is nothing to refuse. The gate
  // is vacuously open rather than reporting "0 divisions unlocked".
  if (unlocked.length === 0) {
    return { open: true, unlocked: [], reason: null, nothingToPlace: false };
  }

  return {
    open: false,
    unlocked,
    reason: `The draw is not locked in ${nameList(unlocked.map(d => d.label))}.`,
    nothingToPlace: false,
  };
}

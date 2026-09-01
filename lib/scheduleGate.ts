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
 * See .scratch/schedule-generator/issues/09-schedule-generation-preconditions.md
 */

export interface GateDivision {
  id: string;
  /** The division's name, as the organizer reads it. */
  label: string;
  /** settings.draw.isLocked — the draw is final, not merely generated. */
  drawLocked: boolean;
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
  /** Organizer-facing reason. Null exactly when the gate is open. */
  reason: string | null;
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
  const unlocked = divisions
    .filter(d => !d.drawLocked)
    .map(d => ({ id: d.id, label: d.label }));

  // No divisions means no matches, so there is nothing to refuse. The gate
  // is vacuously open rather than reporting "0 divisions unlocked".
  if (unlocked.length === 0) return { open: true, unlocked: [], reason: null };

  return {
    open: false,
    unlocked,
    reason: `The draw is not locked in ${nameList(unlocked.map(d => d.label))}.`,
  };
}

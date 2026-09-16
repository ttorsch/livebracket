import type { TeamEditTarget } from './teamEditAccess';

/* ── What a team's own edit actually changed ──────────────────────
 *
 * The organizer's notification says what moved, not just that something
 * did. "They changed the roster" is worth reading on a phone between
 * matches; "the team was updated" only tells you to go and look.
 *
 * It is computed by diffing the stored team before the save against the
 * stored team after it, rather than by reading the request body. A PATCH
 * carries every field the form holds, so a body-based answer would call
 * every save a change to everything. Diffing the real rows means the
 * list can only ever name something that genuinely differs.
 *
 * The phrases are written to sit inside one sentence — "changed the
 * roster and the team name" — so they carry their own articles.
 */

/** Stable enough to compare: key order in a jsonb bag is not meaningful,
 *  and a field cleared to '' is the same absence as a field never set. */
function sameBag(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const norm = (bag: Record<string, unknown>) =>
    JSON.stringify(
      Object.entries(bag ?? {})
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => [k, String(v).trim()])
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return norm(a) === norm(b);
}

/* Sorted, so a roster that came back in a different order is not a
 * change. Ids are part of the fingerprint precisely so that swapping one
 * player for another is — two names arriving in place of two others is
 * the edit an organizer most needs to hear about. */
function rosterChanged(before: TeamEditTarget, after: TeamEditTarget): boolean {
  const fingerprint = (t: TeamEditTarget) =>
    t.players
      .map(p =>
        [
          p.id,
          p.name.trim(),
          p.shirtSize ?? '',
          JSON.stringify(
            Object.entries(p.customFields ?? {})
              .map(([k, v]) => [k, String(v ?? '').trim()])
              .sort(([x], [y]) => x.localeCompare(y)),
          ),
        ].join(' :: '),
      )
      .sort()
      .join(' | ');
  return fingerprint(before) !== fingerprint(after);
}

/**
 * The plain-words list of what this save touched, in the order an
 * organizer cares about. Empty when nothing really changed — a form
 * submitted untouched raises no notification at all.
 *
 * `emailPending` is passed separately because a new contact address is
 * the one change that does not land on save: it waits for a code at the
 * new address, so the rows are identical either side and only the caller
 * knows a change was asked for.
 */
export function describeTeamChanges(
  before: TeamEditTarget,
  after: TeamEditTarget,
  opts: { emailPending?: boolean } = {},
): string[] {
  const changed: string[] = [];

  if (rosterChanged(before, after)) changed.push('the roster');
  if ((before.teamName ?? '') !== (after.teamName ?? '')) changed.push('the team name');
  if ((before.contactPhone ?? '') !== (after.contactPhone ?? '')) changed.push('the contact phone');
  if (opts.emailPending) changed.push('the contact email');
  if (!sameBag(before.customFields, after.customFields)) changed.push('the team details');

  return changed;
}

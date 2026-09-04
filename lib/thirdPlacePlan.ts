/* What changing "play off for 3rd" means for a bracket that already exists.
 *
 * The decision, separated from the writing of it. The route that owns this
 * change talks to three tables and an auth check, none of which a test can
 * reach; what it actually has to get *right* is smaller than that and entirely
 * a matter of reading the bracket:
 *
 *   - which round, if any, is already the play-off,
 *   - which round its two teams would come from,
 *   - and whether the asked-for change is an add, a removal, or nothing.
 *
 * Get any of those wrong and the route deletes the final, or hangs a play-off
 * off the quarter-finals. So they live here, as a pure function over ids, and
 * the route is left with the part that is only plumbing.
 *
 * The play-off is identified by the edge that defines it — the one match drawn
 * from two *losers* — rather than by the round's name, which is the same rule
 * `isThirdPlaceRound` applies on the read side. A round called "3rd Place"
 * with no loser edges is not one, and a differently-named round with them is.
 */

/** A knockout round, as this module needs to see it. */
export interface KnockoutRound {
  id: string;
  /** Order within the division. The final is the highest of the playing
   *  rounds; the play-off, when it exists, is appended above it. */
  sequence: number;
  /** Every match in the round. A round with none cannot be judged either way
   *  and is treated as not the play-off. */
  matchIds: string[];
}

/** Matches drawn from the losers of other matches, keyed by match id — the
 *  shape `settings.draw.loserFeeders` is stored in. */
export type LoserFeeders = Record<string, [string, string] | undefined>;

export type ThirdPlacePlan =
  /** The bracket already says what was asked. Nothing to write but the flag. */
  | { action: 'none' }
  /** Append a play-off fed by `semi`'s two matches, at `sequence`. */
  | { action: 'add'; semi: KnockoutRound; sequence: number }
  /** Delete this round and the match on it. */
  | { action: 'remove'; round: KnockoutRound }
  /** The bracket cannot carry one, and saying why is the useful part. */
  | { action: 'impossible'; reason: string };

/** The play-off for 3rd, or null. See the note above on why this reads edges
 *  rather than names. */
export function findThirdPlaceRound(
  rounds: KnockoutRound[],
  loserFeeders: LoserFeeders,
): KnockoutRound | null {
  return (
    rounds.find(r => r.matchIds.length > 0 && r.matchIds.every(id => !!loserFeeders[id])) ?? null
  );
}

/** The rounds that are actually played through — everything but the play-off,
 *  in order. The final is the last of these and the semifinal the one before. */
export function playingRounds(
  rounds: KnockoutRound[],
  loserFeeders: LoserFeeders,
): KnockoutRound[] {
  const playOff = findThirdPlaceRound(rounds, loserFeeders);
  return [...rounds]
    .sort((a, b) => a.sequence - b.sequence)
    .filter(r => r.id !== playOff?.id);
}

/**
 * What to do to this bracket to make `want` true of it.
 *
 * @param rounds Every knockout round in the division, in any order.
 * @param loserFeeders The division's stored loser edges.
 * @param want The organizer's setting.
 */
export function planThirdPlace(
  rounds: KnockoutRound[],
  loserFeeders: LoserFeeders,
  want: boolean,
): ThirdPlacePlan {
  if (rounds.length === 0) {
    return { action: 'impossible', reason: 'This division has no knockout round to play off inside' };
  }

  const existing = findThirdPlaceRound(rounds, loserFeeders);

  if (!want) return existing ? { action: 'remove', round: existing } : { action: 'none' };
  if (existing) return { action: 'none' };

  /* The two beaten semifinalists have to exist to be drawn from, so there must
     be a round before the final — and it must hold exactly the two matches
     whose losers meet. A four-team draw is the smallest that does; anything
     smaller is a final on its own. */
  const playing = playingRounds(rounds, loserFeeders);
  const semi = playing[playing.length - 2];
  if (!semi || semi.matchIds.length !== 2) {
    return {
      action: 'impossible',
      reason: 'A play-off for 3rd needs a semifinal to draw its two teams from — this bracket has none',
    };
  }

  /* Appended above every existing round rather than wedged in front of the
     final: the bracket is drawn as a halving tree, and a round of one match
     between the semifinals and the final would have the tree connect the wrong
     matches. When it is played is the schedule's business, not the draw's. */
  return { action: 'add', semi, sequence: Math.max(...rounds.map(r => r.sequence)) + 1 };
}

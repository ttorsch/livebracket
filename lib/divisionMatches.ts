// How a division's matches are numbered and named, in one place.
//
// The organizer bracket, the schedule views and the division match list all
// point at the same matches, so they have to agree on what to call them: one
// running number per division across every round (pool play first, then the
// knockout), prefixed with the division's initial — Men M1…, Women W1… — and
// one rule for what an undecided side reads as.

import type { CrossSlot, DetailDivision, DetailMatch, DetailRound } from './data';

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function poolName(index: number): string {
  return POOL_LETTERS[index] ?? String(index + 1);
}

/* Mirrors the server's serpentine `assignPools`: seed-ordered teams are dealt
   into `poolsCount` pools, reversing direction every row so pool strength stays
   balanced. Named pools reproduce what was actually drawn. */
export function assignPools<T>(items: T[], poolsCount: number): { name: string; items: T[] }[] {
  const out: T[][] = Array.from({ length: poolsCount }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / poolsCount);
    const col = i % poolsCount;
    out[row % 2 === 0 ? col : poolsCount - 1 - col].push(item);
  });
  return out
    .map((teams, i) => ({ name: poolName(i), items: teams }))
    .filter(p => p.items.length > 0);
}

/* The letter a division's match numbers carry: its initial. Two divisions
   starting with the same letter share it — the organizer names the divisions,
   so that is their call to make. */
export function divisionPrefix(label: string): string {
  const letter = [...(label ?? '')].find(ch => /\p{L}|\p{N}/u.test(ch));
  return (letter ?? 'M').toUpperCase();
}

/* A knockout slot the crossing has drawn but pool play hasn't filled yet. */
export function crossLabel(slot: CrossSlot): string {
  return `#${slot.rank} Pool ${slot.pool}`;
}

export function isKnockoutRound(round: DetailRound): boolean {
  return round.format === 'single' || round.format === 'double';
}

/* The play-off for 3rd, identified by the edge that defines it: it is the one
   match drawn from two *losers* rather than two winners. Reading it off
   `loserFeeders` rather than off the round's name means nothing downstream
   depends on how the round happens to be titled. */
export function loserFeedersOf(div: DetailDivision): Record<string, [string, string]> {
  return div.drawConfig?.loserFeeders ?? {};
}

export function isThirdPlaceRound(div: DetailDivision, round: DetailRound): boolean {
  const feeders = loserFeedersOf(div);
  return round.matches.length > 0 && round.matches.every(m => !!feeders[m.id]);
}

export interface MatchLabel {
  number: number;      // 25
  no: string;          // "M25"
  teamA: string;       // team name, "#1 Pool A", "BYE" or "Winner of M25"
  teamB: string;
  bye: boolean;        // never played, so it takes no court time
  pool: string | null; // pool name for a round-robin match
}

/* A bye is a knockout pairing with one side and one empty seat: settled before
   it starts, so it is never played and never scheduled. It can only happen in
   the round that opens the knockout — an empty side anywhere after that is a
   slot waiting on the match that feeds it. */
function isBye(
  round: DetailRound,
  m: DetailMatch,
  cross: { a: CrossSlot | null; b: CrossSlot | null } | undefined,
  opensKnockout: boolean,
): boolean {
  if (!isKnockoutRound(round)) return false;
  if (m.teamAName?.toUpperCase() === 'BYE' || m.teamBName?.toUpperCase() === 'BYE') return true;
  if (m.teamAId === 'bye' || m.teamBId === 'bye') return true;
  if (!opensKnockout) return false;
  // Drawn off pool play the sides are pool positions, not teams.
  if (cross) return (cross.a === null) !== (cross.b === null);
  return m.status === 'done' && (m.teamAId === null) !== (m.teamBId === null);
}

/* Which pool each team was drawn into, derived — as everywhere else — from the
   seeds, since pool membership is never stored on the match. */
function poolMembership(div: DetailDivision): Map<string, string> {
  const out = new Map<string, string>();
  const pools = div.drawConfig?.pools;
  if (!pools) return out;
  const confirmed = div.teamsList.filter(t => t.status !== 'waitlist');
  assignPools(confirmed, pools).forEach(pool => {
    pool.items.forEach(team => out.set(team.id, pool.name));
  });
  return out;
}

/* Every match in the division, keyed by match id. */
export function labelDivisionMatches(div: DetailDivision): Map<string, MatchLabel> {
  const prefix = divisionPrefix(div.label);
  const crossSlots = div.drawConfig?.crossSlots ?? {};
  const loserFeeders = loserFeedersOf(div);
  const poolOf = poolMembership(div);
  const opensKnockoutAt = div.bracket.findIndex(isKnockoutRound);

  // Numbers run straight through the division in round order, byes included,
  // so a number means the same match wherever it is shown.
  const numbers = new Map<string, number>();
  let next = 1;
  div.bracket.forEach(round => round.matches.forEach(m => numbers.set(m.id, next++)));

  const out = new Map<string, MatchLabel>();

  div.bracket.forEach((round, ri) => {
    const prev = ri > 0 ? div.bracket[ri - 1] : undefined;
    // A knockout round is fed by the round before it only when that round is
    // itself knockout; the pool round decides pool positions, not slots.
    const feeder = prev && isKnockoutRound(round) && isKnockoutRound(prev) ? prev : undefined;

    round.matches.forEach((m, mi) => {
      const cross = crossSlots[m.id];
      const bye = isBye(round, m, cross, ri === opensKnockoutAt);

      // The 3rd-place play-off is drawn from the two beaten semifinalists, so
      // its sides read "Loser of …" and come from an explicit edge rather than
      // from the round before it — which, since the play-off is drawn last, is
      // the final.
      const losers = loserFeeders[m.id];

      const label = (name: string | null, slot: CrossSlot | null, side: 0 | 1): string => {
        if (name && name !== 'TBD' && name.trim() !== '') return name;
        if (slot) return crossLabel(slot);
        if (bye) return 'BYE';
        if (losers) {
          const no = numbers.get(losers[side] ?? '');
          return no ? `Loser of ${prefix}${no}` : 'TBD';
        }
        const feedNo = feeder ? numbers.get(feeder.matches[2 * mi + side]?.id ?? '') : undefined;
        return feedNo ? `Winner of ${prefix}${feedNo}` : 'TBD';
      };

      const number = numbers.get(m.id) ?? 0;
      out.set(m.id, {
        number,
        no: `${prefix}${number}`,
        teamA: label(m.teamAName, cross?.a ?? null, 0),
        teamB: label(m.teamBName, cross?.b ?? null, 1),
        bye,
        pool: isKnockoutRound(round)
          ? null
          : poolOf.get(m.teamAId ?? '') ?? poolOf.get(m.teamBId ?? '') ?? null,
      });
    });
  });

  return out;
}

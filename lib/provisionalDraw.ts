/* ── The provisional draw ─────────────────────────────────────────────
 *
 * What a division *will* look like, derived from what the organizer has
 * already declared, before a single team has registered.
 *
 * A real draw needs teams. But the *shape* of a division needs none of
 * them: a cap of 16 played in 4 pools advancing 2 is 24 pool matches and an
 * 8-team knockout whatever the names turn out to be. Everything here is
 * arithmetic over four numbers the organizer set at division setup — cap,
 * pools, advancePerPool, and the round list — so nothing is invented and
 * nothing has to be guessed at.
 *
 * The output is a DetailDivision with a synthetic teamsList and bracket and
 * the real settings otherwise, because that is the shape the whole schedule
 * pipeline already speaks: labelDivisionMatches, toSchedulableDivisions,
 * generateSchedule and CourtScheduleView all take it unchanged. A separate
 * "provisional" type would mean a second implementation of every one of
 * them, and the two would drift.
 *
 * The synthetic teams carry real ids on purpose. The scheduler enforces rest
 * and per-day match limits by team id, so giving each placeholder its own id
 * makes the provisional schedule obey the same constraints the real one
 * will — which is the whole reason to look at it. Fabricating null teams
 * instead would produce a plan that fits on paper and not on sand.
 */

import type {
  DetailDivision, DetailMatch, DetailRound, DetailTeam, CrossSlot,
} from './data';
import { assignPools } from './divisionMatches.ts';
import { isGroupFormat, isKnockoutFormat } from './roundFormat.ts';

/** Teams per pool the recommendation aims for. Four is the beach default:
 *  three matches each, and a pool finishes in one session. */
const IDEAL_POOL_SIZE = 4;

/* The same 2–8 the draw screen's stepper allows. A recommendation outside
 * the range the organizer can actually pick would be a recommendation they
 * cannot take. */
const MIN_POOLS = 2;
const MAX_POOLS = 8;

/** How many pools a division of this size wants, as a starting point.
 *
 *  A suggestion, not a rule — the organizer can move it, and the draw
 *  screen still lets them. Divisions too small to split sensibly get the
 *  floor of 2 rather than a single pool, because a one-pool "pool stage" is
 *  a round robin and the organizer should choose that deliberately. */
export function recommendedPools(cap: number): number {
  if (!Number.isFinite(cap) || cap < MIN_POOLS * 2) return MIN_POOLS;
  const byIdealSize = Math.round(cap / IDEAL_POOL_SIZE);
  return Math.max(MIN_POOLS, Math.min(MAX_POOLS, byIdealSize));
}

/** Whether this division plays a play-off for 3rd.
 *
 *  Read from the plan the organizer set, then from what a draw actually ran
 *  with, then true — the same default the draw route applies, so a division
 *  that has never been asked the question behaves identically either side of
 *  a draw. */
export function plannedThirdPlace(settings: {
  thirdPlace?: unknown;
  draw?: { thirdPlace?: unknown } | null;
}): boolean {
  if (typeof settings.thirdPlace === 'boolean') return settings.thirdPlace;
  const drawn = settings.draw?.thirdPlace;
  if (typeof drawn === 'boolean') return drawn;
  return true;
}

/** Read a division's declared pool count, falling back to the recommendation.
 *
 *  Divisions created before pools was a setup field have no stored value, so
 *  they read as whatever their cap suggests — the same number the draw screen
 *  would have opened on. */
export function plannedPools(settings: { pools?: unknown }, cap: number): number {
  const raw = settings.pools;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(MIN_POOLS, Math.min(MAX_POOLS, Math.trunc(raw)));
  }
  return recommendedPools(cap);
}

/* ── Round-robin pairings ────────────────────────────────────────────
 *
 * The circle method, so the result comes out grouped into matchdays in
 * which every team plays at most once. Emitting all of pool A's matches
 * in combination order instead would hand the scheduler a run of matches
 * that all share a team, and it would spend the whole day pulling them
 * apart to satisfy rest.
 */
export function roundRobinRounds(n: number): [number, number][][] {
  if (n < 2) return [];
  // An odd pool gets a phantom opponent; pairings against it are byes and
  // are dropped rather than scheduled.
  const ids = Array.from({ length: n }, (_, i) => i);
  if (ids.length % 2 === 1) ids.push(-1);

  const half = ids.length / 2;
  const rotating = ids.slice(1);
  const rounds: [number, number][][] = [];

  for (let r = 0; r < ids.length - 1; r++) {
    const order = [ids[0], ...rotating];
    const day: [number, number][] = [];
    for (let i = 0; i < half; i++) {
      const a = order[i];
      const b = order[order.length - 1 - i];
      if (a !== -1 && b !== -1) day.push([a, b]);
    }
    rounds.push(day);
    rotating.unshift(rotating.pop() as number);
  }
  return rounds;
}

/** Every pairing in one pool, matchday by matchday. */
export function roundRobinPairs(n: number): [number, number][] {
  return roundRobinRounds(n).flat();
}

/* ── Building the synthetic division ─────────────────────────────── */

const emptyPlayers = () => [] as DetailMatch['teamA'];

function provisionalMatch(id: string): DetailMatch {
  return {
    id,
    court: '',
    time: '',
    scheduledDate: null,
    teamA: emptyPlayers(),
    teamB: emptyPlayers(),
    teamAId: null,
    teamBId: null,
    teamAName: null,
    teamBName: null,
    status: 'upcoming',
  };
}

/** The next power of two at or above `n` — the size of the bracket that
 *  holds `n` qualifiers, with the shortfall played as byes. */
function bracketSize(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export interface ProvisionalOptions {
  /** Pools to split the group stage into. */
  pools: number;
  /** Play a third-place play-off when the bracket is deep enough for one. */
  thirdPlace?: boolean;
}

/**
 * A division as it will be played, with placeholder teams.
 *
 * The real settings are kept — net height, gender, durations, the configured
 * rounds — and only `teamsList`, `bracket` and `drawConfig` are replaced. A
 * division whose draw has already been run is returned untouched: once real
 * matches exist they are the truth, and a projection over the top of them
 * would be strictly worse information.
 *
 * "Already run" means matches, never rounds. A division carries its configured
 * rounds in `bracket` from the moment it is set up — that is where the public
 * page's Round 1 / Round 2 tabs come from — so a non-empty bracket proves
 * nothing. The draw screen draws the same distinction for the same reason.
 */
export function provisionalDivision(
  division: DetailDivision,
  { pools, thirdPlace = true }: ProvisionalOptions,
): DetailDivision {
  if (isDrawn(division)) return division;

  const cap = Math.max(0, Math.trunc(division.teams));
  const rounds = division.configuredRounds;
  if (cap < 2 || rounds.length === 0) return division;

  const hasGroupStage = rounds.some(r => isGroupFormat(r.format));
  const poolCount = hasGroupStage ? Math.max(1, Math.min(pools, Math.floor(cap / 2))) : 0;

  /* Placeholder teams, seeded 1..cap. They are named after the draw has
     grouped them, so a card reads "Team 1" through "Team 4" *within its
     pool* rather than by a global seed number the player has no way to
     know yet. */
  const seeded: DetailTeam[] = Array.from({ length: cap }, (_, i) => ({
    id: `prov:${division.id}:t${i + 1}`,
    name: `Team ${i + 1}`,
    seed: i + 1,
    status: 'confirmed',
  }));

  const grouped = poolCount > 0 ? assignPools(seeded, poolCount) : [];
  const nameByTeam = new Map<string, string>();
  grouped.forEach(pool => {
    pool.items.forEach((team, i) => nameByTeam.set(team.id, `Team ${i + 1}`));
  });
  const teamsList: DetailTeam[] = seeded.map(t => ({ ...t, name: nameByTeam.get(t.id) ?? t.name }));

  const bracket: DetailRound[] = [];
  const crossSlots: Record<string, { a: CrossSlot | null; b: CrossSlot | null }> = {};
  const loserFeeders: Record<string, [string, string]> = {};

  // ── The group stage ───────────────────────────────────────────────
  const groupRound = rounds.find(r => isGroupFormat(r.format));
  if (groupRound && poolCount > 0) {
    const matches: DetailMatch[] = [];
    /* Matchday-major across pools: pool A's first match, then pool B's, and
       so on. The pools rotate together the way they are actually played. */
    const perPool = grouped.map(p => roundRobinRounds(p.items.length));
    const dayCount = Math.max(0, ...perPool.map(r => r.length));
    for (let day = 0; day < dayCount; day++) {
      grouped.forEach((pool, pi) => {
        (perPool[pi][day] ?? []).forEach(([a, b], mi) => {
          const m = provisionalMatch(`prov:${division.id}:g${day}:${pi}:${mi}`);
          m.teamAId = pool.items[a].id;
          m.teamBId = pool.items[b].id;
          m.teamAName = nameByTeam.get(pool.items[a].id) ?? null;
          m.teamBName = nameByTeam.get(pool.items[b].id) ?? null;
          matches.push(m);
        });
      });
    }
    bracket.push({
      round: 'Round 1',
      format: groupRound.format,
      durationMinutes: groupRound.durationMinutes,
      scoringRules: groupRound.scoring as unknown as Record<string, unknown>,
      matches,
    });
  }

  // ── The knockout ──────────────────────────────────────────────────
  const knockoutRound = rounds.find(r => isKnockoutFormat(r.format));
  if (knockoutRound) {
    const advance = Math.max(1, division.advancePerPool);
    const qualifiers = poolCount > 0 ? poolCount * advance : cap;
    const size = bracketSize(Math.max(2, qualifiers));
    const stages = Math.log2(size);

    /* Qualifiers in seeding order — every pool's winner first, then every
       runner-up, and so on. The crossing the organizer picked decides the
       real pairings; this is the order the bracket is built from, and it is
       what the provisional labels describe. */
    const slots: (CrossSlot | null)[] = [];
    for (let rank = 1; rank <= advance && poolCount > 0; rank++) {
      for (let p = 0; p < poolCount; p++) slots.push({ pool: String.fromCharCode(65 + p), rank });
    }
    while (slots.length < size) slots.push(null);

    let previous: DetailMatch[] = [];
    for (let stage = 0; stage < stages; stage++) {
      const count = size / 2 ** (stage + 1);
      const matches: DetailMatch[] = [];
      for (let i = 0; i < count; i++) {
        const m = provisionalMatch(`prov:${division.id}:k${stage}:${i}`);
        if (stage === 0 && poolCount > 0) {
          // Standard bracket seeding: first against last, second against
          // second-last, so the top qualifiers meet as late as possible.
          crossSlots[m.id] = { a: slots[i] ?? null, b: slots[size - 1 - i] ?? null };
        }
        matches.push(m);
      }
      bracket.push({
        round: count === 1 ? 'Final' : `Round ${bracket.length + 1}`,
        format: knockoutRound.format,
        durationMinutes: knockoutRound.durationMinutes,
        scoringRules: knockoutRound.scoring as unknown as Record<string, unknown>,
        matches,
      });
      previous = matches;
    }

    /* The play-off for 3rd, drawn off the two beaten semifinalists. Stated
       as a loser edge rather than left to round order, exactly as the real
       draw states it — see lib/thirdPlacePlan. */
    if (thirdPlace && stages >= 2) {
      const semis = bracket[bracket.length - 2].matches;
      const m = provisionalMatch(`prov:${division.id}:third`);
      loserFeeders[m.id] = [semis[0].id, semis[1].id];
      bracket.push({
        round: '3rd Place',
        format: knockoutRound.format,
        durationMinutes: knockoutRound.durationMinutes,
        scoringRules: knockoutRound.scoring as unknown as Record<string, unknown>,
        matches: [m],
      });
    }
    void previous;
  }

  return {
    ...division,
    filled: cap,
    teamsList,
    bracket,
    drawConfig: {
      pools: poolCount,
      advance: division.advancePerPool,
      crossing: division.crossing,
      attempts: 0,
      topSeedIds: [],
      isLocked: false,
      crossSlots,
      thirdPlace,
      loserFeeders,
    },
  };
}

/** Whether a real draw has produced matches for this division. */
export function isDrawn(division: DetailDivision): boolean {
  return division.bracket.some(r => r.matches.length > 0);
}

/** True when nothing in this tournament has been drawn yet, so a provisional
 *  view is the only schedule there could be. */
export function isUndrawn(divisions: DetailDivision[]): boolean {
  return divisions.length > 0 && !divisions.some(isDrawn);
}

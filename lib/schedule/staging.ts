// Phase 3b — staging the end of the event.
//
// Everywhere else in this generator a match is placed on its own merits: it
// becomes ready when its feeders are done, and the cheapest free court takes
// it. That is the right rule for pool play, where throughput is the whole
// point, and it is the wrong rule for the medal rounds — those are a
// programme, not a queue, and an organizer runs them to a shape:
//
//   semifinals   one division at a time, its two matches side by side, so the
//                division that is waiting is resting rather than idling;
//   3rd place    every division at once, across as many courts as it takes,
//                once every semifinal everywhere is finished;
//   finals       one after another on a single court, so there is exactly one
//                match to watch and the whole venue can watch it.
//
// That shape is expressed here as *waves*. A wave is a set of matches that
// start together, and it is all-or-nothing: it goes when every match in it can
// go and there are enough free courts for all of them, or it waits. Three
// rules order the waves, and between them they are the whole programme:
//
//   1. a wave may not start until every wave of an earlier phase has finished;
//   2. in an exclusive phase (semifinals, finals) only one wave runs at a time;
//   3. in a single-court phase (finals) every wave uses the same one court.
//
// Everything the organizer asked for falls out of those three. Nobody has to
// schedule the rest between a division's semifinal and its final, because the
// other divisions' semifinals are that rest.

import type { DivisionShape, MatchGraph } from './graph.ts';
import { planPoolPlay, type PoolPlan } from './poolplay.ts';
import { divisionGenderCohort, divisionGenderRank } from './types.ts';

/** The medal rounds, in the order they are played. The numbers are the
 *  ordering: a wave waits for every wave of a lower phase. */
export const PHASES = ['pool', 'semifinal', 'third', 'final'] as const;
export type StagePhase = (typeof PHASES)[number];

export function phaseOrder(phase: StagePhase): number {
  return PHASES.indexOf(phase);
}

export interface StageWave {
  key: string;
  phase: StagePhase;
  /** The division this wave belongs to, or null when it spans all of them —
   *  which is what the single 3rd-place wave does. */
  divisionId: string | null;
  matchIds: string[];
  /** Waves that must be finished before this one starts, by key. Used for the
   *  pool rotation, where the ordering is within a division and so cannot come
   *  from the phase alone. */
  after: string[];
  /** Tie-break when several waves want the courts at once; lower goes first.
   *  Carries the pool plan's priority, so the division whose rotation fits the
   *  venue exactly takes it before anyone else. */
  order: number;
}

export interface Staging {
  enabled: boolean;
  waves: StageWave[];
  /** matchId -> its wave. Absent means the match is placed the normal way. */
  waveOf: Map<string, StageWave>;
  /** Every staged match id, for the cost function. */
  staged: Set<string>;
  /** What each division's pool play wanted, for the organizer to see. */
  poolPlans: PoolPlan[];
}

export const NO_STAGING: Staging = {
  enabled: false,
  waves: [],
  waveOf: new Map(),
  staged: new Set(),
  poolPlans: [],
};

/** Phases whose waves are ordered against *every* division's waves. Pool play
 *  is not one of them: one division's round robin has no reason to wait on
 *  another's, and the knockout already waits on its own pools through the
 *  dependency graph. */
export function isGloballyOrdered(phase: StagePhase): boolean {
  return phase !== 'pool';
}

/** Phases where which court a match lands on stops mattering.
 *
 *  True of the medal rounds: there are a handful of matches left, they have to
 *  run side by side, and an organizer will re-rig a net to get them there.
 *  Emphatically not true of pool play, which is most of the event — a division
 *  that wanders off its own courts during the round robin moves the net every
 *  time it does so. */
export function ignoresCourtIdentity(phase: StagePhase): boolean {
  return phase !== 'pool';
}

/** Only one wave of these phases may be in progress at a time. */
export function isExclusive(phase: StagePhase): boolean {
  return phase === 'semifinal' || phase === 'final';
}

/** Every wave of this phase shares one court. */
export function isSingleCourt(phase: StagePhase): boolean {
  return phase === 'final';
}

/** Build the medal-round programme.
 *
 *  `courtCount` is a real constraint rather than a detail: a wave that could
 *  never have enough courts to start at once would block the endgame forever,
 *  so anything wider than the venue is left unstaged and placed the ordinary
 *  way. */
export function buildStaging(
  graph: MatchGraph,
  courtCount: number,
  enabled: boolean,
): Staging {
  if (!enabled) return NO_STAGING;

  const semifinals: StageWave[] = [];
  const thirdPlaceIds: string[] = [];
  const finals: StageWave[] = [];
  const poolWaves: StageWave[] = [];

  // ── Pool play, cohort-based rotation. ─────────────────────────────────
  //
  // Cohort 0 (Gendered: Men, Women) plays first on dedicated courts.
  // Cohort 1 (Non-gendered: Mixed, Open, 4x4) plays later, expanding to all venue courts.
  const shapes = [...graph.divisions.values()];
  const hasCohort0 = shapes.some(s => divisionGenderCohort(s) === 0);

  const plans = shapes
    .map(shape => {
      const poolMatches = [...graph.nodes.values()].filter(n => n.divisionId === shape.divisionId && n.isPool);
      const cohort = divisionGenderCohort(shape);
      const divDedicated = shape.dedicatedCourts;
      // Cohort 0 uses dedicated courts (capped at courtCount).
      // Cohort 1 (if Cohort 0 exists) expands to full venue (courtCount) per Option B.
      const effectiveCourts = cohort === 1 && hasCohort0
        ? (divDedicated != null && divDedicated >= courtCount ? Math.min(courtCount, divDedicated) : courtCount)
        : (divDedicated != null && divDedicated > 0 ? Math.min(courtCount, divDedicated) : courtCount);
      return {
        shape,
        cohort,
        plan: planPoolPlay(shape.divisionId, poolMatches, effectiveCourts),
      };
    })
    .filter((item): item is { shape: DivisionShape; cohort: number; plan: PoolPlan } => item.plan !== null);

  const sortCohort = (
    list: { shape: DivisionShape; cohort: number; plan: PoolPlan }[],
  ) =>
    [...list].sort((a, b) => {
      // 1. Total court-minutes (biggest division first)
      if (b.shape.minutes !== a.shape.minutes) {
        return b.shape.minutes - a.shape.minutes;
      }
      // 2. Standard gender rank (Men -> Women)
      const gA = divisionGenderRank({ gender: a.shape.gender, label: a.shape.label });
      const gB = divisionGenderRank({ gender: b.shape.gender, label: b.shape.label });
      if (gA !== gB) return gA - gB;
      // 3. Stable tie-break by divisionId
      return a.shape.divisionId < b.shape.divisionId ? -1 : 1;
    });

  const cohort0 = sortCohort(plans.filter(p => p.cohort === 0));
  const cohort1 = sortCohort(plans.filter(p => p.cohort === 1));
  const poolPlans: PoolPlan[] = [...cohort0, ...cohort1].map(p => p.plan);

  function stageCohort(
    cohortDivs: { shape: DivisionShape; cohort: number; plan: PoolPlan }[],
    baseOrder: number,
    initialPrereqs: string[],
  ): string[] {
    if (cohortDivs.length === 0) return initialPrereqs;

    const batches: { shape: DivisionShape; plan: PoolPlan; appetite: number }[][] = [];
    let currentBatch: { shape: DivisionShape; plan: PoolPlan; appetite: number }[] = [];
    let remainingCourts = courtCount;

    for (const item of cohortDivs) {
      const appetite = item.shape.dedicatedCourts != null && item.shape.dedicatedCourts > 0
        ? Math.min(courtCount, item.shape.dedicatedCourts)
        : Math.min(courtCount, item.plan.optimalCourts);

      if (currentBatch.length === 0) {
        currentBatch.push({ ...item, appetite });
        remainingCourts = Math.max(0, courtCount - appetite);
      } else if (remainingCourts >= appetite && appetite < courtCount) {
        currentBatch.push({ ...item, appetite });
        remainingCourts -= appetite;
      } else {
        batches.push(currentBatch);
        currentBatch = [{ ...item, appetite }];
        remainingCourts = Math.max(0, courtCount - appetite);
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    let batchPrereqs = [...initialPrereqs];
    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      const batchFinalKeys: string[] = [];
      const prevKeyInDiv = new Map<string, string>();
      const maxWavesInBatch = Math.max(0, ...batch.map(d => d.plan.waves.length));

      for (let wIdx = 0; wIdx < maxWavesInBatch; wIdx++) {
        batch.forEach(({ plan }, divPriority) => {
          if (wIdx >= plan.waves.length) return;
          const matchIds = plan.waves[wIdx];
          const key = `pool:${plan.divisionId}:${wIdx}`;
          const prev = prevKeyInDiv.get(plan.divisionId);
          const after = wIdx === 0 && batchPrereqs.length > 0
            ? [...batchPrereqs]
            : (prev ? [prev] : []);

          poolWaves.push({
            key,
            phase: 'pool',
            divisionId: plan.divisionId,
            matchIds,
            after,
            order: baseOrder + bIdx * 10_000 + wIdx * 1000 + divPriority,
          });
          prevKeyInDiv.set(plan.divisionId, key);
          if (wIdx === plan.waves.length - 1) {
            batchFinalKeys.push(key);
          }
        });
      }
      batchPrereqs = batchFinalKeys;
    }

    return batchPrereqs;
  }

  const cohort0FinalKeys = stageCohort(cohort0, 0, []);
  stageCohort(cohort1, 100_000, cohort0FinalKeys);

  for (const [divisionId, shape] of graph.divisions) {
    // A division with no knockout has no medal rounds to stage.
    if (shape.maxLevel < 1) continue;

    const semis: string[] = [];
    const third: string[] = [];
    const final: string[] = [];

    for (const id of shape.matchIds) {
      const node = graph.nodes.get(id);
      if (!node || node.isPool) continue;
      if (node.isThirdPlace) third.push(id);
      // The final and the play-off for 3rd sit at the same depth — both are
      // drawn off the semifinals — so the play-off has to be taken out before
      // the rest of that level can be called the final.
      else if (node.level === shape.maxLevel) final.push(id);
      else if (node.level === shape.maxLevel - 1) semis.push(id);
    }

    if (semis.length > 0 && semis.length <= courtCount) {
      semifinals.push({ key: `sf:${divisionId}`, phase: 'semifinal', divisionId, matchIds: semis, after: [], order: 0 });
    }
    thirdPlaceIds.push(...third);
    // Finals go one at a time on one court, so a division that somehow has two
    // matches at its final level cannot be staged as a single-court wave.
    if (final.length === 1) {
      finals.push({ key: `f:${divisionId}`, phase: 'final', divisionId, matchIds: final, after: [], order: 0 });
    }
  }

  const waves: StageWave[] = [...poolWaves, ...semifinals];

  // One wave for every division's play-off at once — that *is* the rule, so it
  // is one wave rather than one per division. Too many for the venue and it
  // could never start, so it is dropped rather than left to deadlock.
  if (thirdPlaceIds.length > 0 && thirdPlaceIds.length <= courtCount) {
    waves.push({ key: 'third:all', phase: 'third', divisionId: null, matchIds: thirdPlaceIds, after: [], order: 0 });
  }

  waves.push(...finals);

  const waveOf = new Map<string, StageWave>();
  const staged = new Set<string>();
  for (const wave of waves) {
    for (const id of wave.matchIds) {
      waveOf.set(id, wave);
      staged.add(id);
    }
  }

  return { enabled: waves.length > 0, waves, waveOf, staged, poolPlans };
}

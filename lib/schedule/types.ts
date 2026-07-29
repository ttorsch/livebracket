// Shared vocabulary for the schedule generator.
//
// Everything the generator knows about a tournament is expressed here, in
// plain data: no Supabase rows, no React state, no dates. The caller maps its
// world onto these types once and every phase downstream stays pure and
// testable.
//
// Two ideas carry most of the design:
//
//  1. A court is a *resource with attributes*, not a number. Once a court can
//     describe its own net height and whether it is the show court, "4 courts"
//     and "20 courts", odd counts and even counts, all stop being special
//     cases — they are just a longer or shorter roster.
//
//  2. A match's position in the event is a *dependency*, not a round number.
//     A final is not "round 3", it is "the match that cannot start until both
//     semi-finals are finished". Rounds are how organizers talk; dependencies
//     are what the scheduler can actually reason about.

/** One playing surface for the length of the event. */
export interface CourtSpec {
  name: string;
  /** Net height in metres. null = adjustable/unknown, which never costs a
   *  change buffer because nothing has to be moved. */
  netHeight?: number | null;
  /** Centre court: kept for late-stage matches when anything else will do. */
  isShowCourt?: boolean;
}

/** Which day-plan shape to use on a multi-day event. */
export type DayPlanStrategy =
  /** Every division advances a little every day; all finals land on the last
   *  day. The organizer's choice for this build. */
  | 'parallel-daily'
  /** Each division starts and finishes inside as few consecutive days as
   *  possible, so teams travel on fewer days. */
  | 'compress-division';

/** Relative importance of each soft goal. Because every preference in this
 *  generator is a weight rather than a branch, changing what "a good schedule"
 *  means — max rest vs. finish earliest vs. divisions finishing together — is
 *  an edit to these numbers, not to the algorithm. */
export interface CostWeights {
  /** Per slot a team falls short of its target rest. The organizer chose max
   *  rest as the primary goal, so this dominates everything else. */
  restDeficit: number;
  /** Flat surcharge on top of restDeficit for a genuinely back-to-back match
   *  (zero gap), which players feel far more than a merely short gap. */
  backToBack: number;
  /** Moving a court's net to a different height. Charged once per change; the
   *  physical buffer is charged separately as real court time. */
  netChange: number;
  /** Per slot a team's day is stretched — first match to last. Keeps a team
   *  from being at the venue 09:00–18:00 to play three matches. */
  venueSpan: number;
  /** Per day a match lands away from the day plan's target, which is what
   *  keeps every division progressing together instead of one racing ahead. */
  paceDeviation: number;
  /** Critical-path urgency: matches with a long chain of matches still ahead
   *  of them go first, because they are what decides when the event can
   *  finish. (Keeping a semi-final off day one is the day plan's job, not
   *  this one.) */
  depthUrgency: number;
  /** A pool match occupying the show court. */
  showCourtMisuse: number;
  /** A team being moved to a different court than its previous match, which
   *  costs it a walk across the venue. */
  courtChurn: number;
  /** A division straying off the courts it has been clustered onto. */
  divisionSpread: number;
}

export const DEFAULT_WEIGHTS: CostWeights = {
  restDeficit: 1000,
  backToBack: 4000,
  netChange: 260,
  venueSpan: 55,
  paceDeviation: 420,
  depthUrgency: 34,
  showCourtMisuse: 120,
  courtChurn: 18,
  divisionSpread: 26,
};

/** A stretch of court time the organizer has taken off the board — a
 *  ceremony, a presentation, a net repair, a longer break than lunch.
 *
 *  It is venue configuration rather than a placement, which is why it lives on
 *  the config and survives regeneration: the generator schedules around a block
 *  exactly as it schedules around lunch. A hand-moved *match*, by contrast, is
 *  a one-off that the next generate is free to overwrite. */
export interface BlockedPeriod {
  /** Court name, or null for every court. */
  court: string | null;
  /** 0-based day offset, or null for every day. */
  day: number | null;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  label?: string;
}

export interface ScheduleConfig {
  startTime: string;        // "HH:MM" 24h, day start
  endTime: string;          // "HH:MM" 24h, day end
  courtCount: number;       // used when `courts` is not supplied
  blockMinutes: number;     // one slot of the grid
  lunchStart: string;       // "HH:MM"
  lunchEnd: string;         // "HH:MM"
  netBufferMinutes: number; // court time consumed by a net-height change
  /** Most matches one team may be given on a single day. 0 = no limit. Only
   *  enforceable where the generator knows who is playing, i.e. pool play —
   *  a knockout match's teams aren't decided until the round feeding it is. */
  maxMatchesPerTeamPerDay: number;

  /** The court roster. When absent, `courtCount` generic courts are used, so
   *  existing tournaments keep working untouched. */
  courts?: CourtSpec[];
  /** Target gap between a team's matches, in slots. */
  minRestSlots: number;
  /** true = never break the rest rule, overflowing instead. false = break it
   *  only when the alternative is not placing the match at all. */
  restIsHard: boolean;
  /** Stagger lunch so courts break at slightly different times and the venue
   *  never fully stops. */
  staggerLunch: boolean;
  /** Court time taken off the board by hand. */
  blocks?: BlockedPeriod[];
  /** Hold every division's last round for the final day of a multi-day event. */
  finalsOnLastDay: boolean;
  /** Run each division's semifinals, 3rd-place play-off and final as whole
   *  rounds — side by side across courts, one division's round at a time —
   *  instead of placing each of those matches independently. */
  stageFinals: boolean;
  dayPlan: DayPlanStrategy;
  /** Upper bound on improvement swaps in the repair pass. 0 disables repair. */
  repairIterations: number;
  /** Overrides merged over DEFAULT_WEIGHTS. */
  weights?: Partial<CostWeights>;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  startTime: '09:00',
  endTime: '18:00',
  courtCount: 4,
  blockMinutes: 45,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  netBufferMinutes: 15,
  maxMatchesPerTeamPerDay: 0,
  minRestSlots: 1,
  restIsHard: false,
  staggerLunch: true,
  finalsOnLastDay: true,
  stageFinals: true,
  dayPlan: 'parallel-daily',
  repairIterations: 4000,
};

/** Fallback match length (minutes) when a match/round declares none. */
export const DEFAULT_MATCH_MINUTES = 45;

/** A court/day/time an organizer has fixed by hand. Pinned placements are hard
 *  constraints on the next run: regenerating schedules *around* them rather
 *  than over them is what makes manual edits survive, and what makes an
 *  over-pinned tournament legitimately infeasible. */
export interface PinnedPlacement {
  matchId: string;
  court: string;
  day: number;
  time: string; // "HH:MM"
}

export interface SchedulableMatch {
  id: string;
  teamA: string | null;      // team id (null for TBD / bye)
  teamB: string | null;
  isPool: boolean;           // true = pool-play (round-robin) match
  /** Which pool a round-robin match belongs to ("A", "B", …). Pool play is
   *  scheduled a pool at a time, so the scheduler has to know which pool a
   *  match is in — it cannot work that out from the teams alone. */
  pool?: string | null;
  durationMinutes?: number;  // this match's slot length; falls back to config.blockMinutes
  /** 0-based position of this match's round in the division's setup round
   *  list. Used to derive dependency edges when `dependsOn` is not given. */
  roundIndex?: number;
  /** Explicit feeder matches. When supplied it wins over anything the graph
   *  would infer from round structure. */
  dependsOn?: string[];
  /** The play-off for 3rd. Sits at the same depth as the final — both are
   *  drawn off the semifinals — but is played before it, which is the one thing
   *  the dependency graph cannot work out on its own. */
  isThirdPlace?: boolean;
  /** Referee duty. Modelled now, assigned by hand in this version — the cost
   *  function already treats it as court time against the team's rest, so
   *  turning on automatic assignment later does not reshape anything. */
  refereeTeam?: string | null;
}

export interface SchedulableDivision {
  id: string;
  label: string;
  pools: number;                    // used to auto-derive court affinity
  netHeight?: string | null;        // free text, e.g. "2.24m" — parsed for pivots/grouping
  gender?: string | null;           // e.g. "Men" / "Mixed" — for crossover ordering
  dedicatedCourts?: number | null;  // organizer override for court affinity
  matches: SchedulableMatch[];
}

export interface ScheduleAssignment {
  matchId: string;
  divisionId: string;
  court: string;   // e.g. "Court 2"
  day: number;     // 0-based day offset from the tournament start date
  time: string;    // "HH:MM" start time
  /** true when this placement came from a pin rather than the solver. */
  pinned?: boolean;
}

/** Court time available on one day of the event. */
export interface DayCapacity {
  day: number;              // 0-based day offset
  playableMinutes: number;  // per court, window minus lunch
  courtMinutes: number;     // playableMinutes × courts — the day's total supply
  matchMinutes: number;     // of that, how much the generated schedule used
  matches: number;          // matches placed on this day
}

/** What one division needs from the schedule, before anything is placed. */
export interface DivisionDemand {
  divisionId: string;
  label: string;
  matches: number;
  minutes: number;          // Σ match durations
  netHeight: number | null;
}

/** Something the organizer can change to make an event fit. */
export interface FeasibilityLever {
  kind: 'addCourt' | 'addDay' | 'extendDay' | 'shortenBlock';
  /** How many of the thing: courts, days, minutes per day, or the new block
   *  length in minutes. */
  amount: number;
  detail: string;
}

export type FeasibilityVerdict = 'fits' | 'tight' | 'overflow';

/** A constraint the solver had to give up on to place everything. Reported
 *  rather than hidden — a schedule you can argue with beats one you can't. */
export type Relaxation =
  /** Divisions had to share the venue during pool play instead of taking it in
   *  turns, which means moving nets more often. */
  | 'poolBlocks'
  | 'finalsOnLastDay'
  /** The endgame had to be placed match-by-match: keeping a round together
   *  left something with nowhere to go. */
  | 'stageFinals'
  /** Teams got less than the target gap between matches. */
  | 'restIsHard'
  | 'maxMatchesPerTeamPerDay'
  | 'dayQuota'
  /** The last resort: some teams played with no gap at all. Kept separate from
   *  `restIsHard` because a short gap and no gap are different promises, and an
   *  organizer needs to know which one broke. */
  | 'backToBack';

export function parseHHMM(v: string): number {
  const [h, m] = (v ?? '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toHHMM(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Pull the first number out of a free-text net height ("2.43m (Men)" → 2.43).
 *  Returns null when there's no parseable height (treated as "unknown"). */
export function parseNetHeight(raw?: string | null): number | null {
  if (!raw) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(raw);
  return m ? Number(m[1]) : null;
}

/** Auto court-affinity count for a division: half its pools, min 1. */
export function autoDedicatedCourts(pools: number): number {
  return Math.max(1, Math.ceil((pools || 1) / 2));
}

/** The court roster a config describes, however it describes it. */
export function courtRoster(config: ScheduleConfig): CourtSpec[] {
  if (config.courts && config.courts.length > 0) return config.courts;
  const n = Math.max(1, Math.trunc(config.courtCount) || 1);
  return Array.from({ length: n }, (_, i) => ({ name: `Court ${i + 1}`, netHeight: null }));
}

/** Fill in anything a stored/partial config is missing. */
export function normaliseConfig(partial: Partial<ScheduleConfig> | null | undefined): ScheduleConfig {
  return { ...DEFAULT_SCHEDULE_CONFIG, ...(partial ?? {}) };
}

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
  /** The venue-wide stop. Lunch means nobody plays: every court observes the
   *  same window, and no slot exists inside it. */
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
  /** Gap a team should get between matches, in slots. Read by the validator
   *  when it judges a hand-edited schedule; placement itself treats rest as
   *  two-state — a whole match between a team's matches, or none. */
  minRestSlots: number;
  /** Court time taken off the board by hand. */
  blocks?: BlockedPeriod[];
  /** Hold every division's last round for the final day of a multi-day event. */
  finalsOnLastDay: boolean;
  /** Run each division's semifinals, 3rd-place play-off and final as whole
   *  rounds — side by side across courts, one division's round at a time —
   *  instead of placing each of those matches independently. */
  stageFinals: boolean;
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
  finalsOnLastDay: true,
  stageFinals: true,
};

/** Fallback match length (minutes) when a match/round declares none. */
export const DEFAULT_MATCH_MINUTES = 45;

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
  pools: number;                    // reported; the appetite is read off the draw
  netHeight?: string | null;        // free text, e.g. "2.24m" — parsed for pivots/grouping
  gender?: string | null;           // e.g. "Men" / "Mixed" — decides the queue order
  matches: SchedulableMatch[];
}

export interface ScheduleAssignment {
  matchId: string;
  divisionId: string;
  court: string;   // e.g. "Court 2"
  day: number;     // 0-based day offset from the tournament start date
  time: string;    // "HH:MM" start time
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

/** Standard gender / format priority rank for wave placement:
 *  0 = Men
 *  1 = Women
 *  2 = Mixed / Anyone / Open
 *  3 = Multi-player / 4x4
 */
export function divisionGenderRank(d: { gender?: string | null; label?: string }): number {
  const lbl = (d.label || '').toLowerCase();
  if (/\b(4x4|4v4|6v6|4's|6's|quads|sixes)\b/i.test(lbl)) {
    return 3;
  }
  const g = (d.gender || '').trim().toLowerCase();
  if (g.startsWith('women') || /\b(women|female|girls)\b/i.test(lbl)) return 1;
  if (g.startsWith('men') || /\b(men|male|boys)\b/i.test(lbl)) return 0;
  if (g.startsWith('anyone') || g.startsWith('mixed') || g.startsWith('open') || /\b(mixed|co-ed|coed|open|anyone)\b/i.test(lbl)) return 2;
  return 2;
}

/** Cohort classification:
 *  0 = Gendered divisions (Men, Women) scheduled first in pool play.
 *  1 = Non-gendered divisions (Mixed, Anyone, Open, 4x4, No Gender) scheduled after Cohort 0.
 */
export function divisionGenderCohort(d: { gender?: string | null; label?: string }): number {
  const rank = divisionGenderRank(d);
  return rank <= 1 ? 0 : 1;
}

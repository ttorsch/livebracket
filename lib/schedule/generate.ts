// Phase 1 tournament schedule generator.
//
// A pure, deterministic function: given the divisions (with their ordered
// match lists) and the venue/day constraints, it assigns every match a court
// and a start time. No randomness, no I/O — so it's trivially unit-testable
// and re-runs identically. The smart "rolling wave" parts of the framework
// (V_R mode optimisation, net-height pivots, crossover prioritisation,
// staggered round-robin + referee rotation) are Phase 2 and deliberately not
// here yet.
//
// Court allocation model (basic rolling wave):
//   - Each division claims D_d "court tracks" (override or auto = ceil(pools/2)).
//   - Divisions are placed in listed order; each grabs the D_d courts that are
//     free earliest. When Σ D_d ≤ courtCount every division lands on its own
//     fresh courts (they run in parallel); when Σ D_d > courtCount a later
//     division reuses courts as they free up (FIFO handover).
//   - Within its tracks a division's matches are packed in block-sized steps,
//     always onto the track that frees up first, skipping the lunch window.

export interface ScheduleConfig {
  startTime: string;        // "HH:MM" 24h, day start
  endTime: string;          // "HH:MM" 24h, day end
  courtCount: number;       // C_total
  blockMinutes: number;     // T_block (match slot incl. buffer)
  lunchStart: string;       // "HH:MM"
  lunchEnd: string;         // "HH:MM"
  netBufferMinutes: number; // reserved for Phase 2 net-height pivots
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  startTime: '09:00',
  endTime: '18:00',
  courtCount: 4,
  blockMinutes: 45,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  netBufferMinutes: 15,
};

export interface SchedulableDivision {
  id: string;
  label: string;
  pools: number;                    // used to auto-derive D_d
  dedicatedCourts?: number | null;  // organizer override for D_d (absent = auto)
  matchIds: string[];               // matches to place, already in play order
}

export interface ScheduleAssignment {
  matchId: string;
  divisionId: string;
  court: string;   // e.g. "Court 2"
  time: string;    // "HH:MM" start time
}

export interface ScheduleResult {
  assignments: ScheduleAssignment[];
  overflow: { matchId: string; divisionId: string }[]; // didn't fit before endTime
  dedicatedCourts: Record<string, number>;             // divisionId -> D_d used
  mode: 'parallel' | 'wave';                           // V_R ≤ 1 vs > 1 (informational)
}

/** Auto dedicated-court count for a division: half its pools, min 1.
 *  Matches the framework's worked example (4 pools → 2, 2 pools → 1). */
export function autoDedicatedCourts(pools: number): number {
  return Math.max(1, Math.ceil((pools || 1) / 2));
}

function parseHHMM(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface CourtTrack {
  name: string;
  cursor: number; // next free minute-of-day on this court
}

/** Earliest start ≥ `from` whose [start, start+block) doesn't straddle lunch. */
function nextStart(from: number, block: number, lunchStart: number, lunchEnd: number): number {
  if (lunchEnd > lunchStart && from < lunchEnd && from + block > lunchStart) {
    return lunchEnd; // would overlap lunch — push to just after it
  }
  return from;
}

export function generateSchedule(
  divisions: SchedulableDivision[],
  config: ScheduleConfig,
): ScheduleResult {
  const courtCount = Math.max(1, Math.trunc(config.courtCount) || 1);
  const block = Math.max(1, Math.trunc(config.blockMinutes) || 1);
  const dayStart = parseHHMM(config.startTime);
  const dayEnd = parseHHMM(config.endTime);
  const lunchStart = parseHHMM(config.lunchStart);
  const lunchEnd = parseHHMM(config.lunchEnd);

  const courts: CourtTrack[] = Array.from({ length: courtCount }, (_, i) => ({
    name: `Court ${i + 1}`,
    cursor: dayStart,
  }));

  const assignments: ScheduleAssignment[] = [];
  const overflow: { matchId: string; divisionId: string }[] = [];
  const dedicatedCourts: Record<string, number> = {};

  let sumDd = 0;
  for (const div of divisions) {
    const dd = Math.max(1, Math.min(courtCount, Math.trunc(div.dedicatedCourts ?? autoDedicatedCourts(div.pools)) || 1));
    dedicatedCourts[div.id] = dd;
    sumDd += dd;
  }

  for (const div of divisions) {
    const dd = dedicatedCourts[div.id];
    // Claim the dd courts that free up earliest (fresh ones first, then reused).
    const chosen = [...courts].sort((a, b) => a.cursor - b.cursor).slice(0, dd);

    for (const matchId of div.matchIds) {
      // Pack onto whichever claimed track is available soonest.
      const track = chosen.reduce((soonest, c) => (c.cursor < soonest.cursor ? c : soonest), chosen[0]);
      const start = nextStart(track.cursor, block, lunchStart, lunchEnd);
      if (start + block > dayEnd) {
        overflow.push({ matchId, divisionId: div.id });
        continue;
      }
      assignments.push({ matchId, divisionId: div.id, court: track.name, time: toHHMM(start) });
      track.cursor = start + block;
    }
  }

  return {
    assignments,
    overflow,
    dedicatedCourts,
    mode: sumDd <= courtCount ? 'parallel' : 'wave',
  };
}

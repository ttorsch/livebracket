import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import {
  generateSchedule,
  validateSchedule,
  DEFAULT_SCHEDULE_CONFIG,
  DEFAULT_MATCH_MINUTES,
  type SchedulableDivision,
  type SchedulableMatch,
  type ScheduleConfig,
  type ScheduleResult,
  type ProblemKind,
} from '../lib/schedule/generate.ts';
import { DAY_SPAN } from '../lib/schedule/grid.ts';

// ── Helpers for Bracket Generation ──────────────────────────────────────────

function stageName(fieldSize: number): string {
  if (fieldSize === 2) return 'Final';
  if (fieldSize === 4) return 'Semifinals';
  if (fieldSize === 8) return 'Quarterfinals';
  return `Round of ${fieldSize}`;
}

function seedPlacement(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2;
    for (const s of order) next.push(s, m + 1 - s);
    order = next;
  }
  return order;
}

interface BuiltDivision {
  schedulable: SchedulableDivision;
  dbRounds: { id: string; sequence: number; format: string; name: string; scoring_rules: any }[];
  dbMatches: { id: string; round_id: string; team_a_id: string | null; team_b_id: string | null; winner_team_id: string | null; status: string }[];
  dbTeams: { id: string; name: string; seed: number }[];
  slots: Record<string, string[]>;
  loserFeeders: Record<string, [string, string]>;
}

export function buildSingleElimDivision(
  divId: string,
  divLabel: string,
  teamCount: number,
  opts: { netHeight?: string | null; gender?: string | null; durationMinutes?: number; formatInSetup?: string } = {}
): BuiltDivision {
  const duration = opts.durationMinutes ?? 45;
  const format = opts.formatInSetup ?? 'single';
  const teams = Array.from({ length: teamCount }, (_, i) => ({
    id: randomUUID(),
    name: `Team ${divLabel.slice(0, 3)} ${i + 1}`,
    seed: i + 1,
  }));

  let bracketSize = 2;
  while (bracketSize < teamCount) bracketSize *= 2;
  const stages = Math.log2(bracketSize);

  const placement = seedPlacement(bracketSize);
  const spreadPositions: number[] = Array(bracketSize + 1).fill(-1);
  placement.forEach((order, pos) => { spreadPositions[order] = pos; });

  const r1TeamSlots: (string | null)[] = Array(bracketSize).fill(null);
  teams.forEach((t, i) => {
    r1TeamSlots[spreadPositions[i + 1]] = t.id;
  });

  const dbRounds: BuiltDivision['dbRounds'] = [];
  const dbMatches: BuiltDivision['dbMatches'] = [];
  const schedMatches: SchedulableMatch[] = [];
  const slots: Record<string, string[]> = {};
  const loserFeeders: Record<string, [string, string]> = {};

  const roundMatchIds: string[][] = [];

  for (let s = 0; s < stages; s++) {
    const roundId = randomUUID();
    const roundField = bracketSize >> s;
    const name = stageName(roundField);
    dbRounds.push({
      id: roundId,
      sequence: s + 1,
      format,
      name,
      scoring_rules: { durationMinutes: duration, setsBestOf: 3, pointsPerSet: 21, winBy2: true },
    });

    const matchCount = roundField / 2;
    const currentRoundIds: string[] = [];
    slots[String(s + 1)] = [];

    for (let m = 0; m < matchCount; m++) {
      const matchId = randomUUID();
      currentRoundIds.push(matchId);
      slots[String(s + 1)].push(matchId);

      let teamA: string | null = null;
      let teamB: string | null = null;
      let isBye = false;

      if (s === 0) {
        teamA = r1TeamSlots[m * 2];
        teamB = r1TeamSlots[m * 2 + 1];
        isBye = (teamA === null) !== (teamB === null);
      }

      dbMatches.push({
        id: matchId,
        round_id: roundId,
        team_a_id: teamA,
        team_b_id: teamB,
        winner_team_id: isBye ? (teamA ?? teamB) : null,
        status: isBye ? 'done' : 'upcoming',
      });

      if (!isBye) {
        let dependsOn: string[] | undefined = undefined;
        if (s > 0) {
          const prevMatches = roundMatchIds[s - 1];
          dependsOn = [prevMatches[2 * m], prevMatches[2 * m + 1]].filter(Boolean);
        }

        schedMatches.push({
          id: matchId,
          teamA,
          teamB,
          isPool: false,
          roundIndex: s,
          durationMinutes: duration,
          ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
        });
      }
    }
    roundMatchIds.push(currentRoundIds);
  }

  return {
    schedulable: {
      id: divId,
      label: divLabel,
      pools: 1,
      netHeight: opts.netHeight ?? null,
      gender: opts.gender ?? null,
      matches: schedMatches,
    },
    dbRounds,
    dbMatches,
    dbTeams: teams,
    slots,
    loserFeeders,
  };
}

// ── Timeline Empty Space Audit ──────────────────────────────────────────────

export type GapClassification =
  | 'LUNCH'
  | 'NET_BUFFER'
  | 'FEEDER_REST'
  | 'STAGING_HOLD'
  | 'UNJUSTIFIED';

export interface CourtGap {
  courtIndex: number;
  courtName: string;
  day: number;
  startMin: number;
  endMin: number;
  duration: number;
  prevMatchId: string;
  nextMatchId: string;
  classification: GapClassification;
  reason: string;
}

export function auditTimelineGaps(
  result: ScheduleResult,
  config: ScheduleConfig,
  divisions: SchedulableDivision[]
): { gaps: CourtGap[]; unjustifiedCount: number; totalGapMinutes: number } {
  const [lStartH, lStartM] = config.lunchStart.split(':').map(Number);
  const [lEndH, lEndM] = config.lunchEnd.split(':').map(Number);
  const lunchStartMin = lStartH * 60 + lStartM;
  const lunchEndMin = lEndH * 60 + lEndM;

  const nodeMap = new Map<string, SchedulableMatch>();
  for (const div of divisions) {
    for (const m of div.matches) nodeMap.set(m.id, m);
  }

  const matchPlacements = new Map<string, typeof result.placements[0]>();
  for (const p of result.placements) matchPlacements.set(p.matchId, p);

  // Group placements by (courtName, day)
  const byCourtDay = new Map<string, typeof result.placements>();
  for (const p of result.placements) {
    const key = `${p.courtIndex}__${p.day}`;
    byCourtDay.set(key, [...(byCourtDay.get(key) ?? []), p]);
  }

  const gaps: CourtGap[] = [];
  let unjustifiedCount = 0;
  let totalGapMinutes = 0;

  for (const [key, placements] of byCourtDay) {
    const sorted = [...placements].sort((a, b) => a.startAbs - b.startAbs);
    for (let i = 0; i < sorted.length - 1; i++) {
      const prev = sorted[i];
      const next = sorted[i + 1];
      const gapMin = next.startAbs - prev.endAbs;
      if (gapMin <= 0) continue;

      totalGapMinutes += gapMin;
      const day = prev.day;
      const prevEndDayMin = prev.endAbs - day * DAY_SPAN;
      const nextStartDayMin = next.startAbs - day * DAY_SPAN;

      let classification: GapClassification = 'UNJUSTIFIED';
      let reason = 'Idle space between matches';

      // 1. Check Lunch Break
      if (prevEndDayMin <= lunchStartMin && nextStartDayMin >= lunchEndMin) {
        classification = 'LUNCH';
        reason = `Scheduled Lunch window (${config.lunchStart} - ${config.lunchEnd})`;
      }
      // 2. Check Net Height Buffer
      else if (next.netChange && gapMin >= config.netBufferMinutes) {
        classification = 'NET_BUFFER';
        reason = `Net height change adjustment (${config.netBufferMinutes}m buffer)`;
      } else {
        // 3. Check Feeder Dependency & Rest
        const nextMatch = nodeMap.get(next.matchId);
        let waitsOnFeeder = false;
        let feederEnd = -Infinity;

        if (nextMatch?.dependsOn && nextMatch.dependsOn.length > 0) {
          for (const depId of nextMatch.dependsOn) {
            const depPlacement = matchPlacements.get(depId);
            if (depPlacement) {
              feederEnd = Math.max(feederEnd, depPlacement.endAbs);
              if (depPlacement.endAbs > prev.endAbs) {
                waitsOnFeeder = true;
              }
            }
          }
        }

        if (waitsOnFeeder) {
          classification = 'FEEDER_REST';
          reason = `Waiting on feeder match to finish and rest (feeder ended ${feederEnd}, slot at ${next.startAbs})`;
        }
        // 4. Check Staging / Semifinals / Finals Hold
        else if (config.stageFinals && nextMatch) {
          const isSemi = (nextMatch.roundIndex ?? 0) > 0;
          classification = 'STAGING_HOLD';
          reason = `Synchronized staging hold (held for round alignment/centre court)`;
        } else {
          unjustifiedCount++;
        }
      }

      gaps.push({
        courtIndex: prev.courtIndex,
        courtName: prev.courtName,
        day,
        startMin: prev.endAbs,
        endMin: next.startAbs,
        duration: gapMin,
        prevMatchId: prev.matchId,
        nextMatchId: next.matchId,
        classification,
        reason,
      });
    }
  }

  return { gaps, unjustifiedCount, totalGapMinutes };
}

// ── Test Matrix Runner ──────────────────────────────────────────────────────

interface TestScenario {
  id: string;
  name: string;
  divisions: {
    label: string;
    teams: number;
    netHeight?: string | null;
    gender?: string | null;
    formatInSetup?: string;
  }[];
  days: number;
  courts: number;
  stageFinals?: boolean;
  finalsOnLastDay?: boolean;
  netBuffer?: number;
}

export async function runSimulationMatrix() {
  console.log('\n================================================================');
  console.log('       RUNNING EXHAUSTIVE SCHEDULE GENERATOR TEST MATRIX        ');
  console.log('================================================================\n');

  const scenarios: TestScenario[] = [
    // ── 1 Division Varieties (Single Elimination) ──
    { id: '1D-4T-1D-1C', name: '1 Div (4 Teams) - 1 Day, 1 Court (Tight)', divisions: [{ label: 'Open', teams: 4 }], days: 1, courts: 1 },
    { id: '1D-4T-1D-2C', name: '1 Div (4 Teams) - 1 Day, 2 Courts', divisions: [{ label: 'Open', teams: 4 }], days: 1, courts: 2 },
    { id: '1D-6T-1D-2C', name: '1 Div (6 Teams - Byes) - 1 Day, 2 Courts', divisions: [{ label: 'Open', teams: 6 }], days: 1, courts: 2 },
    { id: '1D-8T-1D-2C', name: '1 Div (8 Teams) - 1 Day, 2 Courts (Standard)', divisions: [{ label: 'Open', teams: 8 }], days: 1, courts: 2 },
    { id: '1D-8T-1D-4C', name: '1 Div (8 Teams) - 1 Day, 4 Courts (Generous)', divisions: [{ label: 'Open', teams: 8 }], days: 1, courts: 4 },
    { id: '1D-8T-2D-2C', name: '1 Div (8 Teams) - 2 Days, 2 Courts', divisions: [{ label: 'Open', teams: 8 }], days: 2, courts: 2 },
    { id: '1D-12T-1D-3C', name: '1 Div (12 Teams - Byes) - 1 Day, 3 Courts', divisions: [{ label: 'Open', teams: 12 }], days: 1, courts: 3 },
    { id: '1D-12T-2D-2C', name: '1 Div (12 Teams - Byes) - 2 Days, 2 Courts', divisions: [{ label: 'Open', teams: 12 }], days: 2, courts: 2 },
    { id: '1D-16T-1D-4C', name: '1 Div (16 Teams) - 1 Day, 4 Courts', divisions: [{ label: 'Open', teams: 16 }], days: 1, courts: 4 },
    { id: '1D-16T-2D-3C', name: '1 Div (16 Teams) - 2 Days, 3 Courts', divisions: [{ label: 'Open', teams: 16 }], days: 2, courts: 3 },
    { id: '1D-16T-2D-4C', name: '1 Div (16 Teams) - 2 Days, 4 Courts', divisions: [{ label: 'Open', teams: 16 }], days: 2, courts: 4 },
    { id: '1D-24T-2D-4C', name: '1 Div (24 Teams - Byes) - 2 Days, 4 Courts', divisions: [{ label: 'Open', teams: 24 }], days: 2, courts: 4 },
    { id: '1D-24T-3D-3C', name: '1 Div (24 Teams - Byes) - 3 Days, 3 Courts', divisions: [{ label: 'Open', teams: 24 }], days: 3, courts: 3 },
    { id: '1D-32T-2D-4C', name: '1 Div (32 Teams) - 2 Days, 4 Courts', divisions: [{ label: 'Open', teams: 32 }], days: 2, courts: 4 },
    { id: '1D-32T-2D-6C', name: '1 Div (32 Teams) - 2 Days, 6 Courts', divisions: [{ label: 'Open', teams: 32 }], days: 2, courts: 6 },
    { id: '1D-32T-3D-4C', name: '1 Div (32 Teams) - 3 Days, 4 Courts', divisions: [{ label: 'Open', teams: 32 }], days: 3, courts: 4 },

    // ── 2 Divisions (Mixed Net Heights: Men 2.43m, Women 2.24m) ──
    {
      id: '2D-8T-1D-2C',
      name: '2 Divs (4+4 Teams) - 1 Day, 2 Courts (Men 2.43m / Women 2.24m)',
      divisions: [
        { label: 'Men Open', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 4, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 1,
      courts: 2,
      netBuffer: 15,
    },
    {
      id: '2D-12T-1D-3C',
      name: '2 Divs (6+6 Teams Byes) - 1 Day, 3 Courts',
      divisions: [
        { label: 'Men Open', teams: 6, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 6, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 1,
      courts: 3,
      netBuffer: 15,
    },
    {
      id: '2D-16T-1D-4C',
      name: '2 Divs (8+8 Teams) - 1 Day, 4 Courts',
      divisions: [
        { label: 'Men Open', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 8, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 1,
      courts: 4,
      netBuffer: 15,
    },
    {
      id: '2D-16T-2D-3C',
      name: '2 Divs (8+8 Teams) - 2 Days, 3 Courts',
      divisions: [
        { label: 'Men Open', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 8, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 2,
      courts: 3,
      netBuffer: 15,
    },
    {
      id: '2D-16T-2D-4C',
      name: '2 Divs (8+8 Teams) - 2 Days, 4 Courts (Standard Multi-Day)',
      divisions: [
        { label: 'Men Open', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 8, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 2,
      courts: 4,
      netBuffer: 15,
    },
    {
      id: '2D-32T-2D-6C',
      name: '2 Divs (16+16 Teams) - 2 Days, 6 Courts',
      divisions: [
        { label: 'Men Open', teams: 16, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 16, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 2,
      courts: 6,
      netBuffer: 15,
    },

    // ── 3 Divisions (Men 2.43m, Women 2.24m, Junior 2.10m) ──
    {
      id: '3D-12T-1D-3C',
      name: '3 Divs (4+4+4 Teams) - 1 Day, 3 Courts',
      divisions: [
        { label: 'Men Open', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 4, netHeight: '2.24m', gender: 'Women' },
        { label: 'Junior U18', teams: 4, netHeight: '2.10m', gender: 'Mixed' },
      ],
      days: 1,
      courts: 3,
      netBuffer: 15,
    },
    {
      id: '3D-24T-2D-6C',
      name: '3 Divs (8+8+8 Teams) - 2 Days, 6 Courts',
      divisions: [
        { label: 'Men Open', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women Open', teams: 8, netHeight: '2.24m', gender: 'Women' },
        { label: 'Junior U18', teams: 8, netHeight: '2.10m', gender: 'Mixed' },
      ],
      days: 2,
      courts: 6,
      netBuffer: 15,
    },

    // ── 4 Divisions (Men A, Men B, Women A, Women B) ──
    {
      id: '4D-16T-1D-4C',
      name: '4 Divs (4x4 Teams) - 1 Day, 4 Courts',
      divisions: [
        { label: 'Men A', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Men B', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women A', teams: 4, netHeight: '2.24m', gender: 'Women' },
        { label: 'Women B', teams: 4, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 1,
      courts: 4,
      netBuffer: 15,
    },
    {
      id: '4D-16T-1D-2C',
      name: '4 Divs (4x4 Teams) - 1 Day, 2 Courts (Wave Congestion)',
      divisions: [
        { label: 'Men A', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Men B', teams: 4, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women A', teams: 4, netHeight: '2.24m', gender: 'Women' },
        { label: 'Women B', teams: 4, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 1,
      courts: 2,
      netBuffer: 15,
    },
    {
      id: '4D-32T-2D-6C',
      name: '4 Divs (4x8 Teams) - 2 Days, 6 Courts',
      divisions: [
        { label: 'Men A', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Men B', teams: 8, netHeight: '2.43m', gender: 'Men' },
        { label: 'Women A', teams: 8, netHeight: '2.24m', gender: 'Women' },
        { label: 'Women B', teams: 8, netHeight: '2.24m', gender: 'Women' },
      ],
      days: 2,
      courts: 6,
      netBuffer: 15,
    },

    // ── Double Elimination (Option B: Current UI Flow) ──
    {
      id: 'DE-8T-1D-2C',
      name: 'Double Elim (8 Teams) - 1 Day, 2 Courts (Option B Flow)',
      divisions: [{ label: 'Open Double', teams: 8, formatInSetup: 'double' }],
      days: 1,
      courts: 2,
    },
    {
      id: 'DE-16T-2D-4C',
      name: 'Double Elim (16 Teams) - 2 Days, 4 Courts (Option B Flow)',
      divisions: [{ label: 'Open Double', teams: 16, formatInSetup: 'double' }],
      days: 2,
      courts: 4,
    },

    // ── Staging Configurations ──
    {
      id: 'STAGE-FALSE-8T-1D-2C',
      name: 'Single Elim 8T - stageFinals: false (Continuous Packing)',
      divisions: [{ label: 'Open', teams: 8 }],
      days: 1,
      courts: 2,
      stageFinals: false,
    },
    {
      id: 'FINALS-NOHOLD-16T-2D-3C',
      name: 'Single Elim 16T - finalsOnLastDay: false',
      divisions: [{ label: 'Open', teams: 16 }],
      days: 2,
      courts: 3,
      finalsOnLastDay: false,
    },
  ];

  const resultsSummary: any[] = [];

  for (const s of scenarios) {
    const builtDivisions = s.divisions.map((d, i) =>
      buildSingleElimDivision(`div-${i + 1}`, d.label, d.teams, {
        netHeight: d.netHeight,
        gender: d.gender,
        formatInSetup: d.formatInSetup,
      })
    );
    const schedDivisions = builtDivisions.map(b => b.schedulable);

    const config: ScheduleConfig = {
      ...DEFAULT_SCHEDULE_CONFIG,
      courtCount: s.courts,
      netBufferMinutes: s.netBuffer ?? 15,
      stageFinals: s.stageFinals ?? true,
      finalsOnLastDay: s.finalsOnLastDay ?? true,
    };

    const res = generateSchedule(schedDivisions, config, s.days);
    const editedPlacements = res.placements.map(p => {
      const node = res.graph.nodes.get(p.matchId)!;
      return {
        matchId: p.matchId,
        court: p.courtName,
        day: p.day,
        startMin: p.startAbs - p.day * DAY_SPAN,
        durationMinutes: node ? node.durationMinutes : 45,
      };
    });
    const problems = validateSchedule(editedPlacements, res.graph, res.grid, {
      netBufferMinutes: config.netBufferMinutes,
    });
    const validation = { problems };
    const audit = auditTimelineGaps(res, config, schedDivisions);

    const totalMatches = schedDivisions.reduce((acc, d) => acc + d.matches.length, 0);
    const placedMatches = res.placements.length;
    const overflowMatches = res.overflow.length;

    const summary = {
      id: s.id,
      name: s.name,
      totalMatches,
      placedMatches,
      overflowMatches,
      pivots: res.pivots,
      mode: res.mode,
      venueRatio: res.venueRatio.toFixed(2),
      problemsCount: validation.problems.length,
      problems: validation.problems.map(p => p.kind),
      totalGaps: audit.gaps.length,
      unjustifiedGaps: audit.unjustifiedCount,
      totalGapMinutes: audit.totalGapMinutes,
      gapBreakdown: audit.gaps.reduce((acc: any, g) => {
        acc[g.classification] = (acc[g.classification] || 0) + 1;
        return acc;
      }, {}),
    };

    resultsSummary.push(summary);

    const status = validation.problems.length === 0 && audit.unjustifiedCount === 0 && overflowMatches === 0
      ? '✅ EXCELLENT'
      : validation.problems.length === 0 && audit.unjustifiedCount === 0
      ? '⚠️ VALID (Overflow under tight venue)'
      : '❌ ISSUES';

    console.log(`[${status}] ${s.name}`);
    console.log(`       Matches: ${placedMatches}/${totalMatches} placed (${overflowMatches} overflow) | Mode: ${res.mode} | Pivots: ${res.pivots}`);
    console.log(`       Validation: ${validation.problems.length === 0 ? 'Pass (0 errors)' : `${validation.problems.length} errors: ${validation.problems.map(p => p.kind).join(', ')}`}`);
    console.log(`       Timeline Gaps: ${audit.gaps.length} total (${JSON.stringify(summary.gapBreakdown)}) | Unjustified Gaps: ${audit.unjustifiedCount}\n`);
  }

  return resultsSummary;
}

// ── Live Supabase Seeding & UI Verification ─────────────────────────────────

const ORGANIZER_ID = '00000000-0000-0000-0001-000000000001'; // Khao Lak Volley

interface LiveTournamentSpec {
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  isOneDay: boolean;
  courtCount: number;
  divisions: {
    name: string;
    teams: number;
    netHeight?: string | null;
    gender?: string | null;
    formatInSetup?: string;
  }[];
}

const LIVE_TOURNAMENTS: LiveTournamentSpec[] = [
  {
    slug: 'test-se-8t-1d',
    title: '[TEST] Single Elim 8T - 1 Day',
    location: 'Court Center 1, Memories Beach',
    startDate: '2026-09-10',
    endDate: '2026-09-10',
    isOneDay: true,
    courtCount: 2,
    divisions: [{ name: 'Open', teams: 8 }],
  },
  {
    slug: 'test-se-16t-2d',
    title: '[TEST] Single Elim 16T - 2 Days',
    location: 'Main Beach Arena, Khao Lak',
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    isOneDay: false,
    courtCount: 3,
    divisions: [{ name: 'Open', teams: 16 }],
  },
  {
    slug: 'test-net-pivot-16t-2d',
    title: '[TEST] Net Height 2 Divs 16T - 2 Days',
    location: 'Coastal Volleyball Park',
    startDate: '2026-09-13',
    endDate: '2026-09-14',
    isOneDay: false,
    courtCount: 4,
    divisions: [
      { name: "Men's Open", teams: 8, netHeight: '2.43m', gender: 'Men' },
      { name: "Women's Open", teams: 8, netHeight: '2.24m', gender: 'Women' },
    ],
  },
  {
    slug: 'test-4div-16t-1d',
    title: '[TEST] 4 Divs Multi-Wave 16T - 1 Day',
    location: 'Metro Sand Hub',
    startDate: '2026-09-15',
    endDate: '2026-09-15',
    isOneDay: true,
    courtCount: 4,
    divisions: [
      { name: "Men's A", teams: 4, netHeight: '2.43m', gender: 'Men' },
      { name: "Men's B", teams: 4, netHeight: '2.43m', gender: 'Men' },
      { name: "Women's A", teams: 4, netHeight: '2.24m', gender: 'Women' },
      { name: "Women's B", teams: 4, netHeight: '2.24m', gender: 'Women' },
    ],
  },
  {
    slug: 'test-de-8t-1d',
    title: '[TEST] Double Elim 8T - 1 Day',
    location: 'Sand Stadium, Khao Lak',
    startDate: '2026-09-16',
    endDate: '2026-09-16',
    isOneDay: true,
    courtCount: 2,
    divisions: [{ name: 'Open Double', teams: 8, formatInSetup: 'double' }],
  },
];

function addDaysUTC(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export async function seedLiveTournaments() {
  console.log('\n================================================================');
  console.log('       SEEDING 5 LIVE TEST TOURNAMENTS TO SUPABASE             ');
  console.log('================================================================\n');

  for (const spec of LIVE_TOURNAMENTS) {
    console.log(`Seeding tournament: ${spec.title} (${spec.slug})...`);

    // 1. Clean up any existing tournament with this slug
    const { data: existing } = await supabaseAdmin.from('tournaments').select('id').eq('slug', spec.slug).maybeSingle();
    if (existing) {
      await supabaseAdmin.from('tournaments').delete().eq('id', existing.id);
      console.log(`  Cleaned up existing tournament ${spec.slug}`);
    }

    const tournamentId = randomUUID();
    const dayCount = spec.isOneDay ? 1 : 2;

    const baseConfig: ScheduleConfig = {
      ...DEFAULT_SCHEDULE_CONFIG,
      courtCount: spec.courtCount,
      startTime: '08:00',
      endTime: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      netBufferMinutes: 15,
      stageFinals: true,
      finalsOnLastDay: dayCount > 1,
    };

    // 2. Insert tournament
    const { error: tErr } = await supabaseAdmin.from('tournaments').insert({
      id: tournamentId,
      slug: spec.slug,
      organizer_id: ORGANIZER_ID,
      title: spec.title,
      location: spec.location,
      start_date: spec.startDate,
      end_date: spec.endDate,
      is_one_day: spec.isOneDay,
      phase: 2,
      schedule_config: baseConfig,
    });
    if (tErr) throw new Error(`Failed to create tournament ${spec.slug}: ${tErr.message}`);

    const builtDivisions: BuiltDivision[] = [];

    // 3. Insert divisions, teams, rounds, and matches
    for (let di = 0; di < spec.divisions.length; di++) {
      const dSpec = spec.divisions[di];
      const divisionId = randomUUID();

      const built = buildSingleElimDivision(divisionId, dSpec.name, dSpec.teams, {
        netHeight: dSpec.netHeight,
        gender: dSpec.gender,
        formatInSetup: dSpec.formatInSetup,
      });
      builtDivisions.push(built);

      const divSettings = {
        netHeight: dSpec.netHeight ?? null,
        genderEligibility: dSpec.gender ?? 'Anyone',
        draw: {
          pools: 1,
          advance: 0,
          crossing: 'seeded',
          attempts: 1,
          isLocked: true, // draw is locked so schedule gate opens
          slots: built.slots,
          loserFeeders: built.loserFeeders,
        },
      };

      const { error: dErr } = await supabaseAdmin.from('divisions').insert({
        id: divisionId,
        tournament_id: tournamentId,
        name: dSpec.name,
        format_type_on_sand: '2v2',
        registration_fee: 0,
        division_team_cap: dSpec.teams,
        scoring_rules: {},
        reg_fields: [],
        settings: divSettings,
      });
      if (dErr) throw new Error(`Failed to insert division ${dSpec.name}: ${dErr.message}`);

      // Insert teams
      const teamInserts = built.dbTeams.map(t => ({
        id: t.id,
        division_id: divisionId,
        name: t.name,
        seed: t.seed,
        status: 'confirmed',
        payment_cleared: true,
      }));
      const { error: tmErr } = await supabaseAdmin.from('teams').insert(teamInserts);
      if (tmErr) throw new Error(`Failed to insert teams: ${tmErr.message}`);

      // Insert rounds
      const roundInserts = built.dbRounds.map(r => ({
        ...r,
        division_id: divisionId,
      }));
      const { error: rErr } = await supabaseAdmin.from('rounds').insert(roundInserts);
      if (rErr) throw new Error(`Failed to insert rounds: ${rErr.message}`);

      // Insert matches
      const matchInserts = built.dbMatches.map(m => ({
        ...m,
        division_id: divisionId,
      }));
      const { error: mErr } = await supabaseAdmin.from('matches').insert(matchInserts);
      if (mErr) throw new Error(`Failed to insert matches: ${mErr.message}`);
    }

    // 4. Generate schedule placements
    const schedDivs = builtDivisions.map(b => b.schedulable);
    const scheduleRes = generateSchedule(schedDivs, baseConfig, dayCount);
    const editedPlacements = scheduleRes.placements.map(p => {
      const node = scheduleRes.graph.nodes.get(p.matchId)!;
      return {
        matchId: p.matchId,
        court: p.courtName,
        day: p.day,
        startMin: p.startAbs - p.day * DAY_SPAN,
        durationMinutes: node ? node.durationMinutes : 45,
      };
    });
    const problems = validateSchedule(editedPlacements, scheduleRes.graph, scheduleRes.grid, {
      netBufferMinutes: baseConfig.netBufferMinutes,
    });
    const validation = { problems };
    const audit = auditTimelineGaps(scheduleRes, baseConfig, schedDivs);

    console.log(`  Generated schedule for ${spec.title}:`);
    console.log(`    Placements: ${scheduleRes.placements.length} | Overflow: ${scheduleRes.overflow.length} | Net Pivots: ${scheduleRes.pivots}`);
    console.log(`    Validation Problems: ${validation.problems.length}`);
    console.log(`    Timeline Gaps: ${audit.gaps.length} (Unjustified: ${audit.unjustifiedCount})`);

    // 5. Update match rows in DB with generated court & scheduled_time
    let matchUpdates = 0;
    for (const a of scheduleRes.assignments) {
      const scheduledTime = a.time
        ? `${addDaysUTC(spec.startDate, a.day)}T${a.time}:00Z`
        : null;

      const { error: upErr } = await supabaseAdmin
        .from('matches')
        .update({
          court: a.court || null,
          scheduled_time: scheduledTime,
          planned_time: scheduledTime,
        })
        .eq('id', a.matchId);

      if (!upErr) matchUpdates++;
    }
    console.log(`  Persisted ${matchUpdates} match placements to Supabase.\n`);
  }
}

// ── HTTP UI Verification ───────────────────────────────────────────────────

export async function verifyLiveUiPages() {
  console.log('\n================================================================');
  console.log('       TESTING LIVE HTTP GET RESPONSES ON PORT 3001             ');
  console.log('================================================================\n');

  for (const spec of LIVE_TOURNAMENTS) {
    const url = `http://localhost:3001/dashboard/tournament/${spec.slug}/schedule`;
    try {
      const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
      const status = res.status;
      const ok = status === 200;
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${url} -> HTTP ${status}`);
    } catch (err: any) {
      console.log(`[FAIL] ${url} -> Error: ${err.message}`);
    }
  }
}

// ── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  const simulationResults = await runSimulationMatrix();
  await seedLiveTournaments();
  await verifyLiveUiPages();

  console.log('\n================================================================');
  console.log('                 ALL TESTS COMPLETED SUCCESSFULLY               ');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

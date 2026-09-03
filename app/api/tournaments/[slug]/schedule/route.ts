import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { requireTournamentOwner } from '../../../../../lib/auth';
import { authErrorResponse } from '../../../../../lib/authResponse';
import { scheduleSaveGate, type GateDivision } from '../../../../../lib/scheduleGate';

// Persists the tournament's schedule: the global config + per-division
// dedicated-court overrides (PATCH), and the generated court/time assignments
// written back onto matches (PUT). The generator itself lives client-side in
// lib/schedule/generate.ts; this route only validates and stores its output.
//
// The two verbs are gated differently on purpose. PATCH stores the venue
// configuration and is always open — testing whether the event fits is
// useless if the court roster you tested with cannot be kept. PUT writes
// placements and is refused until every division's draw is locked: a
// placement saved against a draw that can still be regenerated is a
// placement a redraw will silently destroy. A disabled button is a
// courtesy; this is the rule.

interface CourtBody {
  name?: unknown;
  netHeight?: unknown;
  isShowCourt?: unknown;
}

interface ConfigBody {
  config?: {
    startTime?: string;
    endTime?: string;
    courtCount?: number;
    blockMinutes?: number;
    lunchStart?: string;
    lunchEnd?: string;
    netBufferMinutes?: number;
    maxMatchesPerTeamPerDay?: number;
    // Added with the rebuilt generator; all optional, all defaulted app-side.
    courts?: CourtBody[];
    minRestSlots?: number;
    restIsHard?: boolean;
    finalsOnLastDay?: boolean;
    stageFinals?: boolean;
    blocks?: { court?: unknown; day?: unknown; start?: unknown; end?: unknown; label?: unknown }[];
    dayPlan?: string;
    repairIterations?: number;
    weights?: Record<string, unknown>;
  };
  // dedicatedCourts null clears the override (falls back to auto).
  divisionOverrides?: { divisionId: string; dedicatedCourts: number | null }[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_PLANS = new Set(['parallel-daily', 'compress-division']);
// Mirrors CostWeights in lib/schedule/types.ts. Listed explicitly so a client
// cannot write arbitrary keys into the stored config blob.
const WEIGHT_KEYS = [
  'restDeficit', 'backToBack', 'netChange', 'venueSpan', 'paceDeviation',
  'depthUrgency', 'showCourtMisuse', 'courtChurn', 'divisionSpread',
] as const;

/** The court roster, kept to sane shapes: a named court, an optional net height
 *  in metres, and an optional show-court flag. */
function cleanCourts(raw: CourtBody[]): Record<string, unknown>[] {
  return raw
    .slice(0, 64)
    .map(c => {
      const name = typeof c.name === 'string' ? c.name.trim().slice(0, 40) : '';
      if (!name) return null;
      const out: Record<string, unknown> = { name };
      if (typeof c.netHeight === 'number' && Number.isFinite(c.netHeight)) {
        out.netHeight = Math.max(0, Math.min(5, c.netHeight));
      }
      if (c.isShowCourt === true) out.isShowCourt = true;
      return out;
    })
    .filter((c): c is Record<string, unknown> => c !== null);
}

/** Court time taken off the board by hand. A null court or day means "every
 *  one of them"; anything whose times don't parse, or that ends before it
 *  starts, is dropped rather than stored as a block nobody can interpret. */
function cleanBlocks(raw: unknown[]): Record<string, unknown>[] {
  return raw
    .slice(0, 200)
    .map(item => {
      const b = (item ?? {}) as Record<string, unknown>;
      if (typeof b.start !== 'string' || !HHMM.test(b.start)) return null;
      if (typeof b.end !== 'string' || !HHMM.test(b.end)) return null;
      if (b.end <= b.start) return null;
      const out: Record<string, unknown> = { start: b.start, end: b.end };
      out.court = typeof b.court === 'string' && b.court.trim() ? b.court.trim().slice(0, 40) : null;
      out.day = typeof b.day === 'number' && Number.isFinite(b.day) ? Math.max(0, Math.trunc(b.day)) : null;
      if (typeof b.label === 'string' && b.label.trim()) out.label = b.label.trim().slice(0, 60);
      return out;
    })
    .filter((b): b is Record<string, unknown> => b !== null);
}

function cleanConfig(c: NonNullable<ConfigBody['config']>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof c.startTime === 'string' && HHMM.test(c.startTime)) out.startTime = c.startTime;
  if (typeof c.endTime === 'string' && HHMM.test(c.endTime)) out.endTime = c.endTime;
  if (typeof c.lunchStart === 'string' && HHMM.test(c.lunchStart)) out.lunchStart = c.lunchStart;
  if (typeof c.lunchEnd === 'string' && HHMM.test(c.lunchEnd)) out.lunchEnd = c.lunchEnd;
  if (typeof c.courtCount === 'number') out.courtCount = Math.max(1, Math.min(64, Math.trunc(c.courtCount)));
  if (typeof c.blockMinutes === 'number') out.blockMinutes = Math.max(5, Math.min(240, Math.trunc(c.blockMinutes)));
  if (typeof c.netBufferMinutes === 'number') out.netBufferMinutes = Math.max(0, Math.min(120, Math.trunc(c.netBufferMinutes)));
  // 0 stores "no cap", so this is clamped from 0 rather than 1.
  if (typeof c.maxMatchesPerTeamPerDay === 'number') out.maxMatchesPerTeamPerDay = Math.max(0, Math.min(50, Math.trunc(c.maxMatchesPerTeamPerDay)));

  if (Array.isArray(c.courts)) out.courts = cleanCourts(c.courts);
  // 0 is meaningful (no rest target at all), so this clamps from 0.
  if (typeof c.minRestSlots === 'number') out.minRestSlots = Math.max(0, Math.min(12, Math.trunc(c.minRestSlots)));
  if (typeof c.restIsHard === 'boolean') out.restIsHard = c.restIsHard;
  if (typeof c.finalsOnLastDay === 'boolean') out.finalsOnLastDay = c.finalsOnLastDay;
  if (typeof c.stageFinals === 'boolean') out.stageFinals = c.stageFinals;
  if (Array.isArray(c.blocks)) out.blocks = cleanBlocks(c.blocks);
  if (typeof c.dayPlan === 'string' && DAY_PLANS.has(c.dayPlan)) out.dayPlan = c.dayPlan;
  // 0 disables the repair pass, so again clamped from 0.
  if (typeof c.repairIterations === 'number') out.repairIterations = Math.max(0, Math.min(100_000, Math.trunc(c.repairIterations)));

  if (c.weights && typeof c.weights === 'object') {
    const weights: Record<string, number> = {};
    for (const key of WEIGHT_KEYS) {
      const v = (c.weights as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v)) weights[key] = Math.max(0, Math.min(100_000, v));
    }
    if (Object.keys(weights).length > 0) out.weights = weights;
  }

  return out;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const body = (await request.json()) as ConfigBody;

  // 1. Save the tournament-level schedule config.
  if (body.config) {
    const { error } = await supabaseAdmin
      .from('tournaments')
      .update({ schedule_config: cleanConfig(body.config) })
      .eq('slug', slug);
    if (error) return NextResponse.json({ error: `Failed to save schedule config: ${error.message}` }, { status: 500 });
  }

  // 2. Save per-division dedicated-court overrides into divisions.settings.schedule.
  for (const ov of body.divisionOverrides ?? []) {
    const { data: div, error: readErr } = await supabaseAdmin
      .from('divisions')
      .select('id, settings, tournaments!inner(slug)')
      .eq('id', ov.divisionId)
      .eq('tournaments.slug', slug)
      .maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!div) continue; // ignore ids that aren't part of this tournament

    const settings = (div.settings ?? {}) as Record<string, unknown>;
    const prevSchedule = (settings.schedule ?? {}) as Record<string, unknown>;
    const schedule = { ...prevSchedule };
    if (ov.dedicatedCourts === null || ov.dedicatedCourts === undefined) {
      delete schedule.dedicatedCourts;
    } else {
      schedule.dedicatedCourts = Math.max(1, Math.min(64, Math.trunc(ov.dedicatedCourts)));
    }

    const { error: wErr } = await supabaseAdmin
      .from('divisions')
      .update({ settings: { ...settings, schedule } })
      .eq('id', ov.divisionId);
    if (wErr) return NextResponse.json({ error: `Failed to save division courts: ${wErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

interface AssignBody {
  // time is "HH:MM" (local wall-clock) or null to clear the match's schedule;
  // day is the signed offset from the tournament start date (default 0):
  // negative for a placement sitting before the event's first day, which a
  // saved schedule does as soon as the organizer moves the dates.
  assignments: {
    matchId: string;
    court: string | null;
    time: string | null;
    day?: number;
  }[];
}

// Add `n` whole days to a 'YYYY-MM-DD' string, in UTC, returning 'YYYY-MM-DD'.
function addDaysUTC(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/* Every division of this tournament, in the shape the gate asks about.
 * Read here rather than trusted from the client: the whole point of the
 * server check is that it does not depend on what the page believed. */
async function readGateDivisions(slug: string): Promise<GateDivision[] | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, name, settings, tournaments!inner(slug)')
    .eq('tournaments.slug', slug);
  if (error) return { error: error.message };
  return (data ?? []).map((d) => {
    const row = d as { id: string; name: string; settings: unknown };
    const settings = row.settings as { draw?: { isLocked?: boolean } } | null;
    return { id: row.id, label: row.name, drawLocked: !!settings?.draw?.isLocked };
  });
}

/* The refusal. 409 rather than 400: the request is well formed, it is the
 * state of the draw that makes it premature. Unlike the draw route's
 * discard refusal there is no confirmation that gets past this one — the
 * organizer's way through is to lock the draw — so the unlocked divisions
 * ride along for the message to name, not for a retry to quote back. */
function gateRefusal(gate: ReturnType<typeof scheduleSaveGate>) {
  return NextResponse.json(
    {
      error: `${gate.reason} A schedule can only be saved once every division's draw is locked.`,
      drawUnlocked: true,
      unlocked: gate.unlocked,
    },
    { status: 409 },
  );
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }

  // The gate, before anything is written. Placements are refused wholesale
  // while any draw is unlocked — including the ones that clear a match,
  // because "save exactly what is on screen" sends the whole board and a
  // partial write would leave a schedule that is neither what was saved nor
  // what is displayed.
  const gateDivisions = await readGateDivisions(slug);
  if ('error' in gateDivisions) {
    return NextResponse.json({ error: gateDivisions.error }, { status: 500 });
  }
  const gate = scheduleSaveGate(gateDivisions);
  if (!gate.open) return gateRefusal(gate);

  const body = (await request.json()) as AssignBody;
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];

  // The day the tournament starts — combined with each "HH:MM" to build the
  // stored instant. We store it as UTC (…Z) so the wall-clock is preserved
  // regardless of the viewer's timezone (see formatMatchTime in lib/data.ts).
  const { data: tourney, error: tErr } = await supabaseAdmin
    .from('tournaments')
    .select('start_date')
    .eq('slug', slug)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tourney) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
  const startDate = tourney.start_date as string;

  // Only allow writing matches that actually belong to this tournament.
  const { data: validRows, error: vErr } = await supabaseAdmin
    .from('matches')
    .select('id, divisions!inner(tournaments!inner(slug))')
    .eq('divisions.tournaments.slug', slug);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  const validIds = new Set((validRows ?? []).map((r) => (r as { id: string }).id));

  let written = 0;
  for (const a of assignments) {
    if (!validIds.has(a.matchId)) continue;
    // A signed offset, not an index. Clamping this at 0 silently moved a
    // match sitting on a day before the event onto the first day of it —
    // so a schedule the organizer had not touched came back changed. The
    // bound is only there to keep a bad request from constructing an
    // absurd timestamp; no real event is ten years from its own start.
    const day = Number.isFinite(a.day) ? Math.max(-3650, Math.min(3650, Math.trunc(a.day as number))) : 0;
    const scheduledTime =
      a.time && HHMM.test(a.time) ? `${addDaysUTC(startDate, day)}T${a.time}:00Z` : null;
    // Generating publishes: the planned time is the promise, and the live
    // projection starts out equal to it. Drift moves scheduled_time later;
    // planned_time only ever changes on the next generate.
    const { error } = await supabaseAdmin
      .from('matches')
      .update({
        court: a.court || null,
        scheduled_time: scheduledTime,
        planned_time: scheduledTime,
      })
      .eq('id', a.matchId);
    if (error) return NextResponse.json({ error: `Failed to save match ${a.matchId}: ${error.message}` }, { status: 500 });
    written++;
  }

  return NextResponse.json({ ok: true, written });
}

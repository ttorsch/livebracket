import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

// Persists the tournament's schedule: the global config + per-division
// dedicated-court overrides (PATCH), and the generated court/time assignments
// written back onto matches (PUT). The generator itself lives client-side in
// lib/schedule/generate.ts; this route only validates and stores its output.

interface ConfigBody {
  config?: {
    startTime?: string;
    endTime?: string;
    courtCount?: number;
    blockMinutes?: number;
    lunchStart?: string;
    lunchEnd?: string;
    netBufferMinutes?: number;
  };
  // dedicatedCourts null clears the override (falls back to auto).
  divisionOverrides?: { divisionId: string; dedicatedCourts: number | null }[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanConfig(c: NonNullable<ConfigBody['config']>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof c.startTime === 'string' && HHMM.test(c.startTime)) out.startTime = c.startTime;
  if (typeof c.endTime === 'string' && HHMM.test(c.endTime)) out.endTime = c.endTime;
  if (typeof c.lunchStart === 'string' && HHMM.test(c.lunchStart)) out.lunchStart = c.lunchStart;
  if (typeof c.lunchEnd === 'string' && HHMM.test(c.lunchEnd)) out.lunchEnd = c.lunchEnd;
  if (typeof c.courtCount === 'number') out.courtCount = Math.max(1, Math.min(64, Math.trunc(c.courtCount)));
  if (typeof c.blockMinutes === 'number') out.blockMinutes = Math.max(5, Math.min(240, Math.trunc(c.blockMinutes)));
  if (typeof c.netBufferMinutes === 'number') out.netBufferMinutes = Math.max(0, Math.min(120, Math.trunc(c.netBufferMinutes)));
  return out;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
  // day is the 0-based offset from the tournament start date (default 0).
  assignments: { matchId: string; court: string | null; time: string | null; day?: number }[];
}

// Add `n` whole days to a 'YYYY-MM-DD' string, in UTC, returning 'YYYY-MM-DD'.
function addDaysUTC(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
    const day = Number.isFinite(a.day) ? Math.max(0, Math.trunc(a.day as number)) : 0;
    const scheduledTime =
      a.time && HHMM.test(a.time) ? `${addDaysUTC(startDate, day)}T${a.time}:00Z` : null;
    const { error } = await supabaseAdmin
      .from('matches')
      .update({ court: a.court || null, scheduled_time: scheduledTime })
      .eq('id', a.matchId);
    if (error) return NextResponse.json({ error: `Failed to save match ${a.matchId}: ${error.message}` }, { status: 500 });
    written++;
  }

  return NextResponse.json({ ok: true, written });
}

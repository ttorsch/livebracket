import { supabase } from './supabase';
import { formatTeamName } from './teamName';
import { type ScheduleConfig, normaliseConfig } from './schedule/generate';
import {
  normalizeGender, normalizeAgeLimit, type DivisionGender, type AgeLimit,
} from './divisionEligibility';
import { normalizeRegFields, rosterSize, type RegField } from './registrationFields';

export type { ScheduleConfig };

// Merge a persisted tournaments.schedule_config blob over the defaults so
// callers always get a fully-populated config (the column defaults to '{}',
// and older rows predate several of the fields).
function readScheduleConfig(raw: unknown): ScheduleConfig {
  return normaliseConfig((raw ?? {}) as Partial<ScheduleConfig>);
}

export interface DashboardDivision {
  name: string;
  cap: number;
  filled: number;
  registrationOpens?: string;
  registrationCloses?: string;
}

export interface DashboardTournament {
  id: string; // slug, used in routes
  title: string;
  date: string;
  startDate: string;
  endDate: string;
  location: string;
  phase: number;
  imageUrl: string | null;
  cancelled: boolean;
  organizerName: string | null;
  divisions: DashboardDivision[];
}

export interface TournamentBasicInfo {
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string | null;
  isOneDay: boolean;
  phase: number;
  description: string | null;
  imageUrl: string | null;
  archived: boolean;
  cancelled: boolean;
}

export async function getTournamentBasicInfo(slug: string): Promise<TournamentBasicInfo | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('slug, title, location, start_date, end_date, is_one_day, phase, description, image_url, archived_at, cancelled_at, deleted_at')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load tournament: ${error.message}`);
  // Deleted has no restore UI, unlike archived — it reads as gone, not hidden.
  if (!data || data.deleted_at) return null;

  return {
    slug: data.slug,
    title: data.title,
    location: data.location,
    startDate: data.start_date,
    endDate: data.end_date,
    isOneDay: data.is_one_day,
    phase: data.phase,
    description: data.description,
    imageUrl: data.image_url,
    archived: !!data.archived_at,
    cancelled: !!data.cancelled_at,
  };
}

// ── Organizer setup page: division CRUD ─────────────────────────────
// Loosely typed on purpose — scoring_rules/reg_fields/settings are jsonb
// blobs whose exact shape is owned by the setup page, not this data layer.
export interface SetupRoundRow {
  id: string;
  sequence: number;
  format: string;
  name: string;
  scoringRules: Record<string, unknown>;
  durationMinutes: number; // match slot length for this round (minutes)
}

export interface SetupDivisionRow {
  id: string;
  name: string;
  formatTypeOnSand: string;
  registrationFee: number;
  divisionTeamCap: number;
  regFields: unknown[];
  settings: Record<string, unknown>;
  /** The rounds the *organizer* configured — "a round robin, then a single
   *  elimination" — not the bracket the draw generated from them.
   *
   *  The two are not the same list and must not be confused. A draw expands one
   *  configured elimination round into a stage per level (Round of 16,
   *  Quarterfinals, Semifinals, Final), all of which live in the `rounds` table
   *  because that is where matches hang from. Showing those back to the
   *  organizer as their own setup is wrong: they never chose four elimination
   *  rounds, and the count moves under them every time the draw settings
   *  change. */
  rounds: SetupRoundRow[];
}

/** Collapse a generated bracket back to the rounds it was generated *from*.
 *
 *  The draw builds every knockout stage from one configured elimination round
 *  and gives them all the same scoring, so a run of consecutive same-format
 *  stages is exactly one configured round. Used only as a fallback for
 *  divisions drawn before the configuration was recorded in its own right. */
export function collapseToConfiguredRounds(rounds: SetupRoundRow[]): SetupRoundRow[] {
  const out: SetupRoundRow[] = [];
  for (const r of rounds) {
    if (out.length === 0 || out[out.length - 1].format !== r.format) out.push(r);
  }
  return out;
}

interface SetupDivisionQueryRow {
  id: string;
  name: string;
  format_type_on_sand: string;
  registration_fee: number;
  division_team_cap: number;
  reg_fields: unknown[];
  settings: Record<string, unknown>;
  rounds: { id: string; sequence: number; format: string; name: string; scoring_rules: Record<string, unknown> }[];
}

export async function getSetupDivisions(slug: string): Promise<SetupDivisionRow[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('divisions(id, name, format_type_on_sand, registration_fee, division_team_cap, reg_fields, settings, rounds(id, sequence, format, name, scoring_rules))')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load divisions: ${error.message}`);
  if (!data) return [];

  const divisions = (data as unknown as { divisions: SetupDivisionQueryRow[] }).divisions ?? [];
  return divisions.map((d) => {
    const settings = d.settings ?? {};
    const stored = [...(d.rounds ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => {
        // durationMinutes rides inside scoring_rules; split it back out so the
        // setup page manages it as its own field and scoringRules stays pure.
        const { durationMinutes: _dm, ...scoringRules } = (r.scoring_rules ?? {}) as Record<string, unknown>;
        return { ...r, scoringRules, durationMinutes: readRoundMinutes(r.scoring_rules) };
      });

    // What the organizer configured, in three descending degrees of confidence:
    // the configuration recorded in its own right; failing that, the stored
    // rounds collapsed back out of the bracket they were expanded into; and
    // failing *that* — no draw has run, so nothing has been expanded — the
    // stored rounds exactly as they are. The last case matters: two elimination
    // rounds configured back to back are two rounds, and collapsing them
    // unconditionally would quietly merge them into one.
    // Stored shape is what the setup dialog sends: a format, its scoring, and a
    // match length. Nothing row-shaped, because it describes a configuration
    // rather than a row.
    const configured = (settings as {
      formatRounds?: { format?: string; scoring?: Record<string, unknown>; durationMinutes?: number }[];
    }).formatRounds;
    const rounds = Array.isArray(configured) && configured.length > 0
      // The row-shaped fields are filled in here rather than left undefined —
      // an absent id in particular would collide as a React key.
      ? configured.map((r, i): SetupRoundRow => ({
          id: `cfg_${i}`,
          sequence: i + 1,
          format: String(r.format ?? ''),
          name: '',
          scoringRules: r.scoring ?? {},
          durationMinutes: typeof r.durationMinutes === 'number' ? r.durationMinutes : DEFAULT_MATCH_MINUTES,
        }))
      : (settings as { draw?: unknown }).draw
        ? collapseToConfiguredRounds(stored)
        : stored;

    return {
      id: d.id,
      name: d.name,
      formatTypeOnSand: d.format_type_on_sand,
      registrationFee: d.registration_fee,
      divisionTeamCap: d.division_team_cap,
      regFields: d.reg_fields ?? [],
      settings,
      rounds,
    };
  });
}

/* ── Setup page overview ──────────────────────────────────────────
 *
 * The setup page loads its teams one division at a time, because that is
 * all the table shows. The readiness checklist and the division cards need
 * the whole tournament at once — every division's seats, unpaid teams and
 * waiting list, plus whether the schedule has actually been laid out.
 *
 * Deliberately its own narrow query rather than getTournamentDetail: that
 * one is shared with the public page, and payment status has no business
 * being in a payload players can read.
 */
export interface SetupDivisionSummary {
  id: string;
  name: string;
  cap: number;
  /** Teams holding a seat — everything not on the waiting list. */
  confirmed: number;
  waitlisted: number;
  /** Seated teams whose payment has not cleared. */
  unpaid: number;
  /** settings.draw.isLocked — the draw is final, not merely generated. */
  drawLocked: boolean;
}

export interface SetupOverview {
  divisions: SetupDivisionSummary[];
  /** Courts available to schedule on: the explicit roster if the organizer
   *  built one, otherwise the generic count. */
  courtCount: number;
  totalMatches: number;
  /** Matches carrying both a time and a court. */
  placedMatches: number;
  /** Earliest scheduled slot, e.g. "Aug 18, 09:00". Null when nothing is placed. */
  firstMatchLabel: string | null;
}

interface OverviewDivisionRow {
  id: string;
  name: string;
  division_team_cap: number;
  settings: Record<string, unknown> | null;
  teams: { id: string; status: string; payment_cleared: boolean }[];
  rounds: { matches: { id: string; court: string | null; scheduled_time: string | null }[] }[];
}

export async function getSetupOverview(slug: string): Promise<SetupOverview> {
  const rest =
    'divisions(id, name, division_team_cap, settings, teams(id, status, payment_cleared), rounds(matches(id, court, scheduled_time)))';

  // schedule_config arrived in migration 0007; fall back without it exactly
  // as getTournamentDetail does, so an un-migrated database still loads.
  const runQuery = (withScheduleConfig: boolean) =>
    supabase
      .from('tournaments')
      .select(`slug${withScheduleConfig ? ', schedule_config' : ''}, ${rest}`)
      .eq('slug', slug)
      .maybeSingle();

  let { data, error } = await runQuery(true);
  if (error && /schedule_config/i.test(error.message)) {
    ({ data, error } = await runQuery(false));
  }
  if (error) throw new Error(`Failed to load setup overview: ${error.message}`);

  const empty: SetupOverview = {
    divisions: [], courtCount: 0, totalMatches: 0, placedMatches: 0, firstMatchLabel: null,
  };
  if (!data) return empty;

  const row = data as unknown as {
    schedule_config?: Record<string, unknown> | null;
    divisions: OverviewDivisionRow[];
  };
  const config = readScheduleConfig(row.schedule_config);

  let totalMatches = 0;
  let placedMatches = 0;
  let earliest: string | null = null;

  const divisions = (row.divisions ?? []).map((d): SetupDivisionSummary => {
    const teams = d.teams ?? [];
    const seated = teams.filter(t => t.status !== 'waitlist');
    for (const r of d.rounds ?? []) {
      for (const m of r.matches ?? []) {
        totalMatches++;
        // "Placed" means it has somewhere and sometime to be played. A time
        // without a court is not a schedule anyone can turn up to.
        if (m.scheduled_time && m.court) {
          placedMatches++;
          if (!earliest || m.scheduled_time < earliest) earliest = m.scheduled_time;
        }
      }
    }
    return {
      id: d.id,
      name: d.name,
      cap: d.division_team_cap,
      confirmed: seated.length,
      waitlisted: teams.length - seated.length,
      unpaid: seated.filter(t => !t.payment_cleared).length,
      drawLocked: !!(d.settings as { draw?: { isLocked?: boolean } } | null)?.draw?.isLocked,
    };
  });

  return {
    divisions,
    courtCount: config.courts?.length ?? config.courtCount,
    totalMatches,
    placedMatches,
    firstMatchLabel: earliest
      ? `${new Date(earliest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${formatMatchTime(earliest)}`
      : null,
  };
}

function formatDateRange(startDate: string, endDate: string | null, isOneDay: boolean): string {
  const start = new Date(`${startDate}T00:00:00`);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (isOneDay || !endDate || endDate === startDate) return startLabel;

  const end = new Date(`${endDate}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const monthLabel = start.toLocaleDateString('en-US', { month: 'short' });
  const year = start.getFullYear();
  if (sameMonth) {
    return `${monthLabel} ${start.getDate()}–${end.getDate()}, ${year}`;
  }
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

interface DivisionRow {
  name: string;
  division_team_cap: number;
  settings?: Record<string, unknown> | null;
  teams: { status: string }[];
}

interface TournamentRow {
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string | null;
  is_one_day: boolean;
  phase: number;
  image_url: string | null;
  cancelled_at: string | null;
  divisions: DivisionRow[];
  organizers: { name: string } | null;
}

const TOURNAMENT_CARD_SELECT =
  'slug, title, location, start_date, end_date, is_one_day, phase, image_url, cancelled_at, ' +
  'organizers(name), divisions(name, division_team_cap, settings, teams(status))';

function toDashboardTournament(t: TournamentRow): DashboardTournament {
  return {
    id: t.slug,
    title: t.title,
    date: t.start_date === todayLocal() ? 'Today' : formatDateRange(t.start_date, t.end_date, t.is_one_day),
    startDate: t.start_date,
    endDate: t.end_date ?? t.start_date,
    location: t.location,
    phase: t.phase,
    imageUrl: t.image_url,
    cancelled: !!t.cancelled_at,
    organizerName: t.organizers?.name ?? null,
    divisions: (t.divisions ?? []).map((d) => {
      const settings = (d.settings ?? {}) as Record<string, unknown>;
      return {
        name: d.name,
        cap: d.division_team_cap,
        filled: (d.teams ?? []).filter((team) => team.status !== 'waitlist').length,
        registrationOpens: typeof settings.registrationOpenDate === 'string' ? settings.registrationOpenDate : '',
        registrationCloses: typeof settings.registrationCloseDate === 'string' ? settings.registrationCloseDate : '',
      };
    }),
  };
}

/* The organizer's own events. `organizerId` comes from the session (see
 * /api/auth/session and lib/auth.ts) — before real auth this listed every
 * tournament in the database, which was only ever correct because there
 * was exactly one organizer. */
export async function getDashboardTournaments(organizerId: string): Promise<DashboardTournament[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(TOURNAMENT_CARD_SELECT)
    .eq('organizer_id', organizerId)
    // Archived and deleted events are gone from every list by definition;
    // cancelled ones stay, because the organizer still has to see what they
    // called off.
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('start_date', { ascending: true });

  if (error) throw new Error(`Failed to load tournaments: ${error.message}`);

  return ((data ?? []) as unknown as TournamentRow[]).map(toDashboardTournament);
}

/* The public listing behind the homepage: every organizer's events, not
 * just yours. Deliberately a separate function from the dashboard one — an
 * optional "scope to me" argument on a single function is the kind of thing
 * that gets left off by accident and leaks one organizer's drafts into
 * another's list. Callers filter by phase for what is fit to show. */
export async function getPublicTournaments(): Promise<DashboardTournament[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(TOURNAMENT_CARD_SELECT)
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('start_date', { ascending: true });

  if (error) throw new Error(`Failed to load tournaments: ${error.message}`);

  return ((data ?? []) as unknown as TournamentRow[]).map(toDashboardTournament);
}

export interface CompletedDivisionSlide {
  id: string; // unique slide key
  tournamentId: string; // tournament slug
  tournamentTitle: string;
  location: string;
  dateLabel: string;
  divisionId: string;
  divisionName: string;
  winners: string[]; // [Player1, Player2] or [TeamName]
  completedAt: string; // ISO string of latest completed match
}

interface CompletedQueryTournamentRow {
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string | null;
  is_one_day: boolean;
  phase: number;
  divisions: {
    id: string;
    name: string;
    teams: { id: string; name: string }[];
    rounds: {
      id: string;
      sequence: number;
      format: string;
      name: string;
      matches: {
        id: string;
        status: string;
        winner_team_id: string | null;
        updated_at: string | null;
        scheduled_time: string | null;
        team_a_id: string | null;
        team_b_id: string | null;
        score_a: number[] | null;
        score_b: number[] | null;
      }[];
    }[];
  }[];
}

export interface HomepageStats {
  divisions: number;
  registeredTeams: number;
}

export async function getHomepageStats(): Promise<HomepageStats> {
  try {
    // Query active & announced tournaments (non-archived, non-deleted)
    const { data: tournaments, error } = await supabase
      .from('tournaments')
      .select(`
        phase,
        divisions (
          id,
          teams ( id, status )
        )
      `)
      .is('archived_at', null)
      .is('deleted_at', null);

    if (error || !tournaments) {
      console.error('Failed to load homepage stats:', error);
      return { divisions: 0, registeredTeams: 0 };
    }

    let divisions = 0;
    let registeredTeams = 0;

    for (const t of (tournaments as unknown as { divisions: { id: string; teams: { status: string }[] }[] }[])) {
      for (const d of t.divisions || []) {
        divisions++;
        for (const team of d.teams || []) {
          if (team.status === 'confirmed' || team.status === 'registered' || team.status === 'approved' || (team.status !== 'waitlist' && team.status !== 'withdrawn')) {
            registeredTeams++;
          }
        }
      }
    }

    return {
      divisions,
      registeredTeams,
    };
  } catch (e) {
    console.error('Failed to load homepage stats:', e);
    return {
      divisions: 0,
      registeredTeams: 0,
    };
  }
}

export async function getRecentlyCompletedDivisions(daysCutoff: number = 14): Promise<CompletedDivisionSlide[]> {
  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - daysCutoff);

  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      slug, title, location, start_date, end_date, is_one_day, phase,
      divisions (
        id, name,
        teams ( id, name ),
        rounds (
          id, sequence, format, name,
          matches (
            id, status, winner_team_id, updated_at, scheduled_time,
            team_a_id, team_b_id, score_a, score_b
          )
        )
      )
    `)
    .is('archived_at', null)
    .is('deleted_at', null)
    .gte('phase', 2);

  if (error) {
    console.error('Failed to load completed divisions:', error);
    return [];
  }

  const slides: CompletedDivisionSlide[] = [];
  const rows = (data ?? []) as unknown as CompletedQueryTournamentRow[];

  for (const t of rows) {
    for (const d of t.divisions ?? []) {
      const allDoneMatches: {
        id: string;
        status: string;
        winner_team_id: string | null;
        updated_at: string | null;
        scheduled_time: string | null;
        roundSequence: number;
        roundName: string;
        team_a_id: string | null;
        team_b_id: string | null;
        score_a: number[] | null;
        score_b: number[] | null;
      }[] = [];

      const rounds = [...(d.rounds ?? [])].sort((a, b) => a.sequence - b.sequence);
      for (const r of rounds) {
        for (const m of r.matches ?? []) {
          if (m.status === 'done') {
            allDoneMatches.push({ ...m, roundSequence: r.sequence, roundName: r.name });
          }
        }
      }

      // If no matches are completed in this division, skip
      if (allDoneMatches.length === 0) continue;

      // Find latest completed match timestamp in this division
      let latestCompletedAt: string | null = null;
      for (const m of allDoneMatches) {
        const ts = m.updated_at || m.scheduled_time || t.end_date || t.start_date;
        if (ts) {
          if (!latestCompletedAt || new Date(ts).getTime() > new Date(latestCompletedAt).getTime()) {
            latestCompletedAt = ts;
          }
        }
      }

      // If latest match completed more than daysCutoff (14) days ago, skip
      if (!latestCompletedAt || new Date(latestCompletedAt).getTime() < cutoffDate.getTime()) {
        continue;
      }

      // Determine division champion:
      // Priority 1: Match in a round named 'Final' with a winner
      // Priority 2: Match in the highest sequence round with a winner
      // Priority 3: Match with highest sequence
      const finalRoundMatches = allDoneMatches.filter(
        (m) => /final/i.test(m.roundName) && !/semi/i.test(m.roundName) && !/quarter/i.test(m.roundName)
      );

      let championMatch =
        finalRoundMatches.find((m) => m.winner_team_id) ||
        finalRoundMatches[0] ||
        allDoneMatches.filter((m) => m.winner_team_id).sort((a, b) => b.roundSequence - a.roundSequence)[0] ||
        allDoneMatches[allDoneMatches.length - 1];

      let winningTeamId = championMatch?.winner_team_id;
      if (!winningTeamId && championMatch) {
        // In case winner_team_id is not set, infer from score_a vs score_b
        if (championMatch.score_a && championMatch.score_b && championMatch.team_a_id && championMatch.team_b_id) {
          const sumA = championMatch.score_a.reduce((s, x) => s + x, 0);
          const sumB = championMatch.score_b.reduce((s, x) => s + x, 0);
          winningTeamId = sumA >= sumB ? championMatch.team_a_id : championMatch.team_b_id;
        }
      }

      let winningTeamName = '';
      if (winningTeamId) {
        const team = (d.teams ?? []).find((tm) => tm.id === winningTeamId);
        if (team) {
          winningTeamName = team.name;
        }
      }

      if (!winningTeamName && championMatch?.team_a_id) {
        const team = (d.teams ?? []).find((tm) => tm.id === championMatch.team_a_id);
        if (team) winningTeamName = team.name;
      }

      if (!winningTeamName) continue;

      const formattedName = formatTeamName(winningTeamName);
      const players = formattedName.includes('/')
        ? formattedName.split('/').map((p) => p.trim()).filter(Boolean)
        : [formattedName];

      slides.push({
        id: `${t.slug}-${d.id}`,
        tournamentId: t.slug,
        tournamentTitle: t.title,
        location: t.location,
        dateLabel: formatDateRange(t.start_date, t.end_date, t.is_one_day),
        divisionId: d.id,
        divisionName: d.name,
        winners: players,
        completedAt: latestCompletedAt,
      });
    }
  }

  slides.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return slides;
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Tournament detail page ──────────────────────────────────────── */

export interface DetailMatchPlayer {
  name: string;
  flag: string;
}

export interface DetailMatch {
  id: string;
  court: string;
  time: string;
  scheduledDate: string | null; // UTC 'YYYY-MM-DD' of the scheduled slot (null = unscheduled)
  teamA: DetailMatchPlayer[];
  teamB: DetailMatchPlayer[];
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
  scoreA?: number[];
  scoreB?: number[];
  // Only set for a match in progress, folded in from Redis by
  // applyLiveScores: the side that won the most recent point, and the epoch
  // ms the match clock runs from.
  lastScorer?: 'a' | 'b' | null;
  startedAt?: number | null;
  winner?: 'A' | 'B';
  status: 'live' | 'upcoming' | 'done';
}

export interface ConfiguredRound {
  format: string;             // 'round-robin' | 'single' | 'double' | 'pool'
  scoring: {
    setsBestOf: number;
    pointsPerSet: number;
    winBy2: boolean;
    hardCap: number;          // 0 = no cap
    decidingSetPoints: number;
  };
  durationMinutes: number;
}

export interface DetailRound {
  round: string;
  format: string;
  durationMinutes?: number; // match slot length for this round (minutes)
  matches: DetailMatch[];
}

export interface DetailTeam {
  id: string;
  name: string;
  seed: number;
  status: string;
  registeredBy?: string | null;
}

// One knockout slot as the bracket crossing defines it: "whoever finishes
// `rank` in pool `pool`". Pool play decides who that is, so until then the
// slot has no team — it renders as "#1 Pool A".
export interface CrossSlot {
  pool: string; // pool name: 'A', 'B', ...
  rank: number; // 1-based finishing position within the pool
}

// Organizer draw settings persisted on divisions.settings.draw.
// `slots` records the generated bracket's match order per round sequence
// (matches have no slot column, and render order defines the bracket tree).
// `crossSlots` records the pool positions drawn into each first-round
// knockout match, keyed by match id.
export interface DrawConfig {
  pools: number;
  advance: number;
  crossing: string;
  attempts: number;
  topSeedIds: string[];
  isLocked?: boolean;
  slots?: Record<string, string[]>;
  crossSlots?: Record<string, { a: CrossSlot | null; b: CrossSlot | null }>;
  /** Organizer wants a play-off for 3rd between the beaten semifinalists. */
  thirdPlace?: boolean;
  /** Matches drawn from the *losers* of two other matches, keyed by match id.
   *  The 3rd-place play-off is the only one, and it is the single edge a
   *  halving bracket cannot express — everything else is fed by winners. */
  loserFeeders?: Record<string, [string, string]>;
}

export interface DetailDivision {
  id: string;
  label: string;
  teams: number; // cap
  filled: number;
  teamsList: DetailTeam[];
  bracket: DetailRound[];
  drawConfig: DrawConfig | null;
  dedicatedCourts: number | null; // D_d override from settings.schedule (null = auto)
  netHeight: string | null;       // settings.netHeight (free text, e.g. "2.24m")
  // Advertised eligibility, normalised out of the settings blob — legacy
  // spellings like "Mixed" and "Open" read as Anyone. See
  // lib/divisionEligibility.
  gender: DivisionGender;
  ageLimit: AgeLimit;             // '' when the division has no age cap
  // Registration is decided per division by these two, not by a switch on
  // the tournament — see lib/tournamentLifecycle.
  registrationOpens: string;      // datetime-local, '' = as soon as public
  registrationCloses: string;     // 'YYYY-MM-DD', '' = never closes
  // ── What the public registration form needs to render itself ──
  /* The rounds the organizer *configured* ("a round robin, then a single
     elimination"), not the bracket stages a draw expanded them into — the
     public Format & Rules panel describes the former. Same derivation as
     getSetupDivisions; see the note there. */
  configuredRounds: ConfiguredRound[];
  /* Teams leaving each pool for the next round, as the organizer set it at
     division setup. drawConfig.advance is what a draw actually ran with; this
     is the intent, and it exists before any draw has been run. */
  advancePerPool: number;
  /* Seeding out of the pools, as the organizer set it at division setup.
     drawConfig.crossing is what a draw actually ran with. */
  crossing: string;
  registrationFee: number;        // flat, per team; 0 is a legitimate fee
  formatTypeOnSand: string;       // '2v2' … '6v6' — the roster's floor
  rosterSize: number;             // players the form asks for, alternates included
  regFields: RegField[];          // the questions this division asks each player
  waitlistCap: number;            // teams accepted past the cap; 0 = none
  rules: string;                  // shown alongside the rules consent
  prizePool: string;              // division prize structure or award breakdown
  confirmationMessage: string;    // organizer's own post-registration note
}

export interface DetailVoucher {
  id: string;
  title: string;
  description: string;
  code: string;
}

export interface TournamentDetail {
  slug: string;
  title: string;
  location: string;
  date: string;
  startDate: string;
  endDate: string;
  dayCount: number; // number of days the tournament spans (>= 1)
  phase: number;
  imageUrl: string | null;
  archived: boolean;
  cancelled: boolean;
  description: string | null;
  scheduleConfig: ScheduleConfig;
  divisions: DetailDivision[];
  vouchers: DetailVoucher[];
}

function teamNameToPlayers(name: string): DetailMatchPlayer[] {
  return name.split('/').map((part) => ({ name: part.trim(), flag: '' }));
}

// Order a round's matches by the generated slot list; matches not in the
// list (or when no list exists) keep their original relative order at the end.
function sortBySlots<T extends { id: string }>(matches: T[], slotIds?: string[]): T[] {
  if (!slotIds || slotIds.length === 0) return matches;
  const pos = new Map(slotIds.map((id, i) => [id, i]));
  return [...matches].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
}

// Scheduled times are stored as UTC instants whose wall-clock equals the
// organizer's intended local time (see the schedule save route), so render
// them in UTC — otherwise a viewer's browser timezone would shift every slot.
function formatMatchTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// The calendar date (UTC 'YYYY-MM-DD') of a scheduled match — used to place it
// on the right day of a multi-day event. UTC for the same reason as above.
function formatMatchDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Whole days spanned by an inclusive date range ('YYYY-MM-DD' strings).
function diffDaysUTC(start: string, end: string): number {
  const toUTC = (v: string) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUTC(end) - toUTC(start)) / 86_400_000);
}

interface MatchRow {
  id: string;
  court: string | null;
  scheduled_time: string | null;
  status: 'live' | 'upcoming' | 'done';
  score_a: number[] | null;
  score_b: number[] | null;
  team_a_id: string;
  team_b_id: string;
  winner_team_id: string | null;
  team_a: { id: string; name: string } | null;
  team_b: { id: string; name: string } | null;
}

interface RoundRow {
  id: string;
  sequence: number;
  format: string;
  name: string;
  scoring_rules?: Record<string, unknown> | null;
  matches: MatchRow[];
}

// Per-round match length is stored inside the round's scoring_rules jsonb blob
// (under `durationMinutes`) so no schema migration is needed — the same blob
// already carries the round's scoring config. Falls back to a sane default.
const DEFAULT_MATCH_MINUTES = 45;

/* Read one configured round's scoring out of its jsonb blob, defaulting each
   field the way the scorekeeper does so the public panel never prints a blank
   where a rule should be. */
function readScoring(blob: unknown): ConfiguredRound['scoring'] {
  const b = (blob ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    setsBestOf: num(b.setsBestOf, 3),
    pointsPerSet: num(b.pointsPerSet, 21),
    winBy2: b.winBy2 !== false,
    hardCap: num(b.hardCap, 0),
    decidingSetPoints: num(b.decidingSetPoints, 15),
  };
}

/* The organizer's configuration, preferred over the bracket a draw expanded
   it into. Mirrors getSetupDivisions: the recorded configuration first, then
   — for divisions drawn before it was recorded — the stored rounds collapsed
   back out of the bracket, and failing that the stored rounds as they are. */
function readConfiguredRounds(
  settings: Record<string, unknown>,
  stored: { sequence: number; format: string; scoring_rules?: Record<string, unknown> | null }[],
): ConfiguredRound[] {
  const configured = (settings as {
    formatRounds?: { format?: string; scoring?: unknown; durationMinutes?: unknown }[];
  }).formatRounds;

  if (Array.isArray(configured) && configured.length > 0) {
    return configured.map(r => ({
      format: String(r.format ?? ''),
      scoring: readScoring(r.scoring),
      durationMinutes: typeof r.durationMinutes === 'number' ? r.durationMinutes : DEFAULT_MATCH_MINUTES,
    }));
  }

  const ordered = [...stored].sort((a, b) => a.sequence - b.sequence);
  const source = settings.draw
    // A run of consecutive same-format stages came from one configured round.
    ? ordered.filter((r, i) => i === 0 || ordered[i - 1].format !== r.format)
    : ordered;

  return source.map(r => ({
    format: r.format,
    scoring: readScoring(r.scoring_rules),
    durationMinutes: readRoundMinutes(r.scoring_rules),
  }));
}
function readRoundMinutes(blob: Record<string, unknown> | null | undefined): number {
  const v = (blob as { durationMinutes?: unknown } | null | undefined)?.durationMinutes;
  return typeof v === 'number' && v > 0 ? Math.trunc(v) : DEFAULT_MATCH_MINUTES;
}

export interface DetailTeam {
  id: string;
  name: string;
  seed: number;
  status: string;
  registeredBy?: string | null;
  players?: { id: string; name: string; userId?: string | null }[];
}

interface TeamRow {
  id: string;
  name: string;
  seed: number;
  status: string;
  registered_by?: string | null;
  players?: { id: string; name: string; user_id?: string | null }[];
}

interface DetailDivisionRow {
  id: string;
  name: string;
  division_team_cap: number;
  registration_fee: number | string; // numeric column — supabase-js hands it back as a string
  format_type_on_sand: string;
  reg_fields: unknown;
  settings: Record<string, unknown> | null;
  teams: TeamRow[];
  rounds: RoundRow[];
}

interface VoucherRow {
  id: string;
  code: string;
  discount_type: 'flat' | 'percent';
  discount_value: number;
}

interface TournamentDetailRow {
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string | null;
  is_one_day: boolean;
  phase: number;
  description: string | null;
  image_url: string | null;
  archived_at: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  schedule_config?: Record<string, unknown> | null; // absent when migration 0007 not yet applied
  divisions: DetailDivisionRow[];
  vouchers: VoucherRow[];
}

export async function getTournamentDetail(slug: string): Promise<TournamentDetail | null> {
  // schedule_config is added by migration 0007. Query with it, but if the
  // column isn't there yet (migration not applied), retry without it so the
  // shared detail query — and the public tournament page — keep working and
  // simply fall back to default schedule settings.
  const rest = `
      divisions (
        id, name, division_team_cap, registration_fee, format_type_on_sand, reg_fields, settings,
        teams ( id, name, seed, status, registered_by, players ( id, name, user_id ) ),
        rounds (
          id, sequence, format, name, scoring_rules,
          matches (
            id, court, scheduled_time, status, score_a, score_b,
            team_a_id, team_b_id, winner_team_id,
            team_a:teams!matches_team_a_id_fkey(id,name),
            team_b:teams!matches_team_b_id_fkey(id,name)
          )
        )
      ),
      vouchers ( id, code, discount_type, discount_value )`;
  const baseCols = 'slug, title, location, start_date, end_date, is_one_day, phase, description, image_url, archived_at, cancelled_at, deleted_at';

  const runQuery = (withScheduleConfig: boolean) =>
    supabase
      .from('tournaments')
      .select(`${baseCols}${withScheduleConfig ? ', schedule_config' : ''}, ${rest}`)
      .eq('slug', slug)
      .maybeSingle();

  let { data, error } = await runQuery(true);
  if (error && /schedule_config/i.test(error.message)) {
    ({ data, error } = await runQuery(false));
  }

  if (error) throw new Error(`Failed to load tournament: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as TournamentDetailRow;
  // Deleted has no restore UI, unlike archived — it reads as gone, not hidden.
  if (row.deleted_at) return null;

  return {
    slug: row.slug,
    title: row.title,
    location: row.location,
    date: row.start_date === todayLocal() ? 'Today' : formatDateRange(row.start_date, row.end_date, row.is_one_day),
    startDate: row.start_date,
    endDate: row.end_date ?? row.start_date,
    dayCount: row.is_one_day || !row.end_date ? 1 : Math.max(1, diffDaysUTC(row.start_date, row.end_date) + 1),
    phase: row.phase,
    imageUrl: row.image_url ?? null,
    archived: !!row.archived_at,
    cancelled: !!row.cancelled_at,
    description: row.description,
    scheduleConfig: readScheduleConfig(row.schedule_config),
    divisions: row.divisions.map((d) => {
      const draw = (d.settings as { draw?: Partial<DrawConfig> } | null)?.draw;
      const sched = (d.settings as { schedule?: { dedicatedCourts?: number } } | null)?.schedule;
      const settings = (d.settings ?? {}) as {
        netHeight?: unknown; genderEligibility?: unknown; ageLimit?: unknown;
        registrationOpenDate?: unknown; registrationCloseDate?: unknown;
        maxRosterSize?: unknown; waitlistCap?: unknown; rules?: unknown;
        confirmationMessage?: unknown; advancePerPool?: number; crossing?: string;
      };
      return {
        id: d.id,
        label: d.name,
        teams: d.division_team_cap,
        filled: d.teams.filter((team) => team.status !== 'waitlist').length,
        teamsList: [...d.teams]
          .sort((a, b) => a.seed - b.seed)
          .map((team) => ({
            id: team.id,
            name: formatTeamName(team.name),
            seed: team.seed,
            status: team.status,
            registeredBy: (team as any).registered_by ?? null,
            players: (team.players || []).map((p) => ({
              id: p.id,
              name: p.name,
              userId: p.user_id ?? null,
            })),
          })),
        bracket: [...d.rounds]
          .sort((a, b) => a.sequence - b.sequence)
          .map((r) => ({
            round: r.name,
            format: r.format,
            durationMinutes: readRoundMinutes(r.scoring_rules),
            matches: sortBySlots(r.matches, draw?.slots?.[String(r.sequence)]).map((m) => ({
              id: m.id,
              court: m.court ?? '',
              time: formatMatchTime(m.scheduled_time),
              scheduledDate: formatMatchDate(m.scheduled_time),
              teamA: teamNameToPlayers(m.team_a?.name ?? 'TBD'),
              teamB: teamNameToPlayers(m.team_b?.name ?? 'TBD'),
              teamAId: m.team_a_id ?? null,
              teamBId: m.team_b_id ?? null,
              teamAName: formatTeamName(m.team_a?.name ?? null),
              teamBName: formatTeamName(m.team_b?.name ?? null),
              scoreA: m.score_a ?? undefined,
              scoreB: m.score_b ?? undefined,
              winner: m.winner_team_id && m.winner_team_id === m.team_a_id ? 'A' : m.winner_team_id && m.winner_team_id === m.team_b_id ? 'B' : undefined,
              status: m.status,
            })),
          })),
        drawConfig: draw
          ? {
              pools: draw.pools ?? 4, advance: draw.advance ?? 2, crossing: draw.crossing ?? 'fivb',
              attempts: draw.attempts ?? 0, topSeedIds: draw.topSeedIds ?? [],
              isLocked: !!draw.isLocked,
              crossSlots: draw.crossSlots ?? {},
              thirdPlace: !!draw.thirdPlace,
              loserFeeders: draw.loserFeeders ?? {},
            }
          : null,
        dedicatedCourts: typeof sched?.dedicatedCourts === 'number' ? sched.dedicatedCourts : null,
        netHeight: typeof settings.netHeight === 'string' ? settings.netHeight : null,
        gender: normalizeGender(settings.genderEligibility),
        ageLimit: normalizeAgeLimit(settings.ageLimit),
        registrationOpens: typeof settings.registrationOpenDate === 'string' ? settings.registrationOpenDate : '',
        registrationCloses: typeof settings.registrationCloseDate === 'string' ? settings.registrationCloseDate : '',
        configuredRounds: readConfiguredRounds(settings as Record<string, unknown>, d.rounds),
        advancePerPool: typeof settings.advancePerPool === 'number'
          ? Math.max(1, Math.min(4, Math.trunc(settings.advancePerPool)))
          : 2,
        crossing: typeof settings.crossing === 'string' && settings.crossing ? settings.crossing : 'fivb',
        registrationFee: Number(d.registration_fee ?? 0) || 0,
        formatTypeOnSand: d.format_type_on_sand,
        rosterSize: rosterSize(d.format_type_on_sand, settings.maxRosterSize),
        regFields: normalizeRegFields(d.reg_fields),
        waitlistCap: typeof settings.waitlistCap === 'number' ? Math.max(0, Math.trunc(settings.waitlistCap)) : 0,
        rules: typeof settings.rules === 'string' ? settings.rules : '',
        prizePool: typeof (settings as { prizePool?: unknown }).prizePool === 'string' ? (settings as { prizePool: string }).prizePool : '',
        confirmationMessage: typeof settings.confirmationMessage === 'string' ? settings.confirmationMessage : '',
      };
    }),
    vouchers: row.vouchers.map((v) => ({
      id: v.id,
      title: v.discount_type === 'percent' ? `${v.discount_value}% off with code ${v.code}` : `${v.discount_value} THB off with code ${v.code}`,
      description: 'Apply this code during registration or at check-in.',
      code: v.code,
    })),
  };
}

export interface RegisteredPlayerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  shirtSize: string | null;
}

export interface RegisteredTeamRow {
  id: string;
  name: string;
  seed: number | null;
  paymentCleared: boolean;
  status: 'confirmed' | 'unpaid' | 'waitlist';
  players: RegisteredPlayerRow[];
}

export async function getDivisionTeams(slug: string, divisionId: string): Promise<RegisteredTeamRow[]> {
  if (typeof window !== 'undefined') {
    const res = await fetch(`/api/tournaments/${slug}/divisions/${divisionId}`);
    if (!res.ok) throw new Error('Failed to load registered teams');
    return res.json();
  }

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, seed, payment_cleared, status, players(id, name, phone, email, shirt_size)')
    .eq('division_id', divisionId)
    .order('seed', { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to load teams: ${error.message}`);
  if (!data) return [];

  return (data as any[]).map((t) => ({
    id: t.id,
    name: formatTeamName(t.name),
    seed: t.seed,
    paymentCleared: t.payment_cleared,
    status: t.status,
    players: (t.players ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      shirtSize: p.shirt_size,
    })),
  }));
}

import { supabase } from './supabase';
import { type ScheduleConfig, DEFAULT_SCHEDULE_CONFIG } from './schedule/generate';

export type { ScheduleConfig };

// Merge a persisted tournaments.schedule_config blob over the defaults so
// callers always get a fully-populated config (the column defaults to '{}').
function readScheduleConfig(raw: unknown): ScheduleConfig {
  const c = (raw ?? {}) as Partial<ScheduleConfig>;
  return {
    startTime: typeof c.startTime === 'string' ? c.startTime : DEFAULT_SCHEDULE_CONFIG.startTime,
    endTime: typeof c.endTime === 'string' ? c.endTime : DEFAULT_SCHEDULE_CONFIG.endTime,
    courtCount: typeof c.courtCount === 'number' ? c.courtCount : DEFAULT_SCHEDULE_CONFIG.courtCount,
    blockMinutes: typeof c.blockMinutes === 'number' ? c.blockMinutes : DEFAULT_SCHEDULE_CONFIG.blockMinutes,
    lunchStart: typeof c.lunchStart === 'string' ? c.lunchStart : DEFAULT_SCHEDULE_CONFIG.lunchStart,
    lunchEnd: typeof c.lunchEnd === 'string' ? c.lunchEnd : DEFAULT_SCHEDULE_CONFIG.lunchEnd,
    netBufferMinutes: typeof c.netBufferMinutes === 'number' ? c.netBufferMinutes : DEFAULT_SCHEDULE_CONFIG.netBufferMinutes,
  };
}

export interface DashboardDivision {
  name: string;
  cap: number;
  filled: number;
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
}

export async function getTournamentBasicInfo(slug: string): Promise<TournamentBasicInfo | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('slug, title, location, start_date, end_date, is_one_day, phase, description, image_url')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load tournament: ${error.message}`);
  if (!data) return null;

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
}

export interface SetupDivisionRow {
  id: string;
  name: string;
  formatTypeOnSand: string;
  registrationFee: number;
  divisionTeamCap: number;
  regFields: unknown[];
  settings: Record<string, unknown>;
  rounds: SetupRoundRow[];
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
  return divisions.map((d) => ({
    id: d.id,
    name: d.name,
    formatTypeOnSand: d.format_type_on_sand,
    registrationFee: d.registration_fee,
    divisionTeamCap: d.division_team_cap,
    regFields: d.reg_fields ?? [],
    settings: d.settings ?? {},
    rounds: [...(d.rounds ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({ ...r, scoringRules: r.scoring_rules ?? {} })),
  }));
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
  divisions: DivisionRow[];
}

export async function getDashboardTournaments(): Promise<DashboardTournament[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('slug, title, location, start_date, end_date, is_one_day, phase, image_url, divisions(name, division_team_cap, teams(status))')
    .order('start_date', { ascending: true });

  if (error) throw new Error(`Failed to load tournaments: ${error.message}`);

  return ((data ?? []) as unknown as TournamentRow[]).map((t) => ({
    id: t.slug,
    title: t.title,
    date: t.start_date === todayLocal() ? 'Today' : formatDateRange(t.start_date, t.end_date, t.is_one_day),
    startDate: t.start_date,
    endDate: t.end_date ?? t.start_date,
    location: t.location,
    phase: t.phase,
    imageUrl: t.image_url,
    divisions: t.divisions.map((d) => ({
      name: d.name,
      cap: d.division_team_cap,
      filled: d.teams.filter((team) => team.status !== 'waitlist').length,
    })),
  }));
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
  teamA: DetailMatchPlayer[];
  teamB: DetailMatchPlayer[];
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
  scoreA?: number[];
  scoreB?: number[];
  winner?: 'A' | 'B';
  status: 'live' | 'upcoming' | 'done';
}

export interface DetailRound {
  round: string;
  format: string;
  matches: DetailMatch[];
}

export interface DetailTeam {
  id: string;
  name: string;
  seed: number;
  status: string;
}

// Organizer draw settings persisted on divisions.settings.draw.
// `slots` records the generated bracket's match order per round sequence
// (matches have no slot column, and render order defines the bracket tree).
export interface DrawConfig {
  pools: number;
  advance: number;
  crossing: string;
  attempts: number;
  topSeedIds: string[];
  isLocked?: boolean;
  slots?: Record<string, string[]>;
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
  phase: number;
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
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
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
  matches: MatchRow[];
}

interface TeamRow {
  id: string;
  name: string;
  seed: number;
  status: string;
}

interface DetailDivisionRow {
  id: string;
  name: string;
  division_team_cap: number;
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
        id, name, division_team_cap, settings,
        teams ( id, name, seed, status ),
        rounds (
          id, sequence, format, name,
          matches (
            id, court, scheduled_time, status, score_a, score_b,
            team_a_id, team_b_id, winner_team_id,
            team_a:teams!matches_team_a_id_fkey(id,name),
            team_b:teams!matches_team_b_id_fkey(id,name)
          )
        )
      ),
      vouchers ( id, code, discount_type, discount_value )`;
  const baseCols = 'slug, title, location, start_date, end_date, is_one_day, phase, description';

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

  return {
    slug: row.slug,
    title: row.title,
    location: row.location,
    date: row.start_date === todayLocal() ? 'Today' : formatDateRange(row.start_date, row.end_date, row.is_one_day),
    startDate: row.start_date,
    phase: row.phase,
    description: row.description,
    scheduleConfig: readScheduleConfig(row.schedule_config),
    divisions: row.divisions.map((d) => {
      const draw = (d.settings as { draw?: Partial<DrawConfig> } | null)?.draw;
      const sched = (d.settings as { schedule?: { dedicatedCourts?: number } } | null)?.schedule;
      return {
        id: d.id,
        label: d.name,
        teams: d.division_team_cap,
        filled: d.teams.filter((team) => team.status !== 'waitlist').length,
        teamsList: [...d.teams]
          .sort((a, b) => a.seed - b.seed)
          .map((team) => ({ id: team.id, name: team.name, seed: team.seed, status: team.status })),
        bracket: [...d.rounds]
          .sort((a, b) => a.sequence - b.sequence)
          .map((r) => ({
            round: r.name,
            format: r.format,
            matches: sortBySlots(r.matches, draw?.slots?.[String(r.sequence)]).map((m) => ({
              id: m.id,
              court: m.court ?? '',
              time: formatMatchTime(m.scheduled_time),
              teamA: teamNameToPlayers(m.team_a?.name ?? 'TBD'),
              teamB: teamNameToPlayers(m.team_b?.name ?? 'TBD'),
              teamAId: m.team_a_id ?? null,
              teamBId: m.team_b_id ?? null,
              teamAName: m.team_a?.name ?? null,
              teamBName: m.team_b?.name ?? null,
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
            }
          : null,
        dedicatedCourts: typeof sched?.dedicatedCourts === 'number' ? sched.dedicatedCourts : null,
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
    name: t.name,
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

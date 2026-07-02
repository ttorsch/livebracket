import { supabase } from './supabase';

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
  location: string;
  phase: number;
  divisions: DashboardDivision[];
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
  divisions: DivisionRow[];
}

export async function getDashboardTournaments(): Promise<DashboardTournament[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('slug, title, location, start_date, end_date, is_one_day, phase, divisions(name, division_team_cap, teams(status))')
    .order('start_date', { ascending: true });

  if (error) throw new Error(`Failed to load tournaments: ${error.message}`);

  return ((data ?? []) as unknown as TournamentRow[]).map((t) => ({
    id: t.slug,
    title: t.title,
    date: t.start_date === todayLocal() ? 'Today' : formatDateRange(t.start_date, t.end_date, t.is_one_day),
    startDate: t.start_date,
    location: t.location,
    phase: t.phase,
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
  scoreA?: number[];
  scoreB?: number[];
  winner?: 'A' | 'B';
  status: 'live' | 'upcoming' | 'done';
}

export interface DetailRound {
  round: string;
  matches: DetailMatch[];
}

export interface DetailTeam {
  name: string;
  seed: number;
  status: string;
}

export interface DetailDivision {
  id: string;
  label: string;
  teams: number; // cap
  filled: number;
  teamsList: DetailTeam[];
  bracket: DetailRound[];
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
  divisions: DetailDivision[];
  vouchers: DetailVoucher[];
}

function teamNameToPlayers(name: string): DetailMatchPlayer[] {
  return name.split('/').map((part) => ({ name: part.trim(), flag: '' }));
}

function formatMatchTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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
  divisions: DetailDivisionRow[];
  vouchers: VoucherRow[];
}

export async function getTournamentDetail(slug: string): Promise<TournamentDetail | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      slug, title, location, start_date, end_date, is_one_day, phase, description,
      divisions (
        id, name, division_team_cap,
        teams ( id, name, seed, status ),
        rounds (
          id, sequence, name,
          matches (
            id, court, scheduled_time, status, score_a, score_b,
            team_a_id, team_b_id, winner_team_id,
            team_a:teams!matches_team_a_id_fkey(id,name),
            team_b:teams!matches_team_b_id_fkey(id,name)
          )
        )
      ),
      vouchers ( id, code, discount_type, discount_value )
    `)
    .eq('slug', slug)
    .maybeSingle();

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
    divisions: row.divisions.map((d) => ({
      id: d.id,
      label: d.name,
      teams: d.division_team_cap,
      filled: d.teams.filter((team) => team.status !== 'waitlist').length,
      teamsList: [...d.teams]
        .sort((a, b) => a.seed - b.seed)
        .map((team) => ({ name: team.name, seed: team.seed, status: team.status })),
      bracket: [...d.rounds]
        .sort((a, b) => a.sequence - b.sequence)
        .map((r) => ({
          round: r.name,
          matches: r.matches.map((m) => ({
            id: m.id,
            court: m.court ?? '',
            time: formatMatchTime(m.scheduled_time),
            teamA: teamNameToPlayers(m.team_a?.name ?? 'TBD'),
            teamB: teamNameToPlayers(m.team_b?.name ?? 'TBD'),
            scoreA: m.score_a ?? undefined,
            scoreB: m.score_b ?? undefined,
            winner: m.winner_team_id === m.team_a_id ? 'A' : m.winner_team_id === m.team_b_id ? 'B' : undefined,
            status: m.status,
          })),
        })),
    })),
    vouchers: row.vouchers.map((v) => ({
      id: v.id,
      title: v.discount_type === 'percent' ? `${v.discount_value}% off with code ${v.code}` : `${v.discount_value} THB off with code ${v.code}`,
      description: 'Apply this code during registration or at check-in.',
      code: v.code,
    })),
  };
}

// One-off seed script for demo data. Run with:
//   node --env-file=.env.local scripts/seed-demo-data.mjs
// Uses the service-role key (bypasses RLS) — never run this against a
// database you don't own, and never import this pattern into app code.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Deterministic UUIDs so the script is easy to re-read and re-run (delete
// rows with these ids to reset). Segment 4 = entity type, segment 5 = index.
const TYPE = {
  organizer: 1, tournament: 2, division: 3, round: 4,
  team: 5, match: 6, player: 7, voucher: 8, registration: 9,
};
const id = (type, n) => `00000000-0000-0000-000${TYPE[type]}-${String(n).padStart(12, '0')}`;

let counters = { tournament: 0, division: 0, round: 0, team: 0, match: 0, player: 0, voucher: 0, registration: 0 };
const nextId = (type) => id(type, ++counters[type]);

const ORGANIZER_ID = id('organizer', 1);

const FIRST = ['Ananda', 'Somchai', 'Chalermsak', 'Nattapong', 'Kittipong', 'Preecha', 'Wichai', 'Anucha',
  'Santos', 'Lima', 'Silva', 'Costa', 'Dias', 'Rocha', 'Alves', 'Moreira'];
const SECOND = ['Suwan', 'Boonmee', 'Charoen', 'Rattana', 'Wattana', 'Pornsak', 'Thongchai', 'Kaewta',
  'Ferreira', 'Souza', 'Pereira', 'Gomes', 'Martins', 'Araujo', 'Cardoso', 'Teixeira'];
function teamName(i) {
  return `${FIRST[i % FIRST.length]} / ${SECOND[(i * 5 + 3) % SECOND.length]}`;
}

const organizers = [{
  id: ORGANIZER_ID,
  auth_user_id: null,
  email: 'thana@khaolakvolley.club',
  name: 'Thana Sirichai',
  club: 'Khao Lak Volley Club',
}];

const tournaments = [];
const divisions = [];
const rounds = [];
const teams = [];
const players = [];
const registrations = [];
const matches = [];
const vouchers = [];

function addDivision(tournamentId, { name, format, fee, cap, rules = {} }) {
  const divId = nextId('division');
  divisions.push({
    id: divId,
    tournament_id: tournamentId,
    name,
    format_type_on_sand: format,
    registration_fee: fee,
    division_team_cap: cap,
    scoring_rules: { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25, ...rules },
    reg_fields: [
      { key: 'playerName', label: 'Player name', type: 'text', required: true },
      { key: 'phone', label: 'Phone', type: 'text', required: true },
      { key: 'shirt', label: 'Shirt size', type: 'select', options: ['S', 'M', 'L', 'XL'], required: false },
    ],
  });
  return divId;
}

function addTeams(divisionId, count, { status = 'confirmed', waitlistFrom = null, startIndex = 0 } = {}) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const teamId = nextId('team');
    const rowStatus = waitlistFrom !== null && i >= waitlistFrom ? 'waitlist' : status;
    const paymentCleared = rowStatus === 'confirmed';
    teams.push({
      id: teamId,
      division_id: divisionId,
      name: teamName(startIndex + i),
      seed: i + 1,
      payment_cleared: paymentCleared,
      status: rowStatus,
    });
    registrations.push({
      id: nextId('registration'),
      division_id: divisionId,
      team_id: teamId,
      payment_status: rowStatus === 'confirmed' ? 'cleared' : 'pending',
      amount_paid: rowStatus === 'confirmed' ? divisions.find(d => d.id === divisionId).registration_fee : 0,
      submitted_at: new Date().toISOString(),
    });
    ids.push(teamId);
  }
  return ids;
}

function addPlayers(teamId, count = 2) {
  for (let i = 0; i < count; i++) {
    players.push({
      id: nextId('player'),
      team_id: teamId,
      name: `${FIRST[(counters.player + i) % FIRST.length]} ${SECOND[(counters.player + i * 3) % SECOND.length]}`,
      phone: `08${String(10000000 + counters.player).slice(0, 8)}`,
      email: null,
      shirt_size: ['S', 'M', 'L', 'XL'][counters.player % 4],
    });
  }
}

function addRound(divisionId, sequence, format, name) {
  const roundId = nextId('round');
  rounds.push({ id: roundId, division_id: divisionId, sequence, format, name });
  return roundId;
}

function addMatch(roundId, divisionId, { court, time, teamA, teamB, scoreA, scoreB, winner, status, liveSnapshot }) {
  matches.push({
    id: nextId('match'),
    round_id: roundId,
    division_id: divisionId,
    court,
    scheduled_time: time,
    team_a_id: teamA,
    team_b_id: teamB,
    score_a: scoreA ?? null,
    score_b: scoreB ?? null,
    winner_team_id: winner ?? null,
    status,
    live_snapshot: liveSnapshot ?? null,
    updated_at: new Date().toISOString(),
  });
}

// ── 1. Draft — no divisions, still being planned ──────────────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'trang-beach-cup-2026', organizer_id: ORGANIZER_ID,
    title: 'Trang Beach Cup 2026', location: 'Pak Meng Beach, Trang',
    start_date: '2026-09-20', end_date: '2026-09-21', is_one_day: false, phase: 1,
    description: 'Early planning stage — divisions and schedule still being finalized.',
  };
  tournaments.push(t);
}

// ── 2. Announced — division defined, registration not open yet ────────────
{
  const t = {
    id: nextId('tournament'), slug: 'krabi-sunset-invitational-2026', organizer_id: ORGANIZER_ID,
    title: 'Krabi Sunset Invitational 2026', location: 'Ao Nang Beach, Krabi',
    start_date: '2026-08-15', end_date: '2026-08-16', is_one_day: false, phase: 2,
    description: 'Registration opens soon — division details announced.',
  };
  tournaments.push(t);
  addDivision(t.id, { name: 'Open 4v4', format: '4v4', fee: 800, cap: 10 });
}

// ── 3. Open registration, one-day ──────────────────────────────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'khao-lak-open-2026', organizer_id: ORGANIZER_ID,
    title: 'Khao Lak Open 2026', location: 'Memories Beach, Khao Lak',
    start_date: '2026-07-25', end_date: '2026-07-25', is_one_day: true, phase: 3,
    description: 'One-day open division tournament — registration in progress.',
  };
  tournaments.push(t);
  const men = addDivision(t.id, { name: "Men's Open", format: '2v2', fee: 500, cap: 8 });
  const women = addDivision(t.id, { name: "Women's Open", format: '2v2', fee: 500, cap: 8 });
  addTeams(men, 4, { startIndex: 0 });
  addTeams(women, 3, { startIndex: 10 });
  vouchers.push({
    id: nextId('voucher'), tournament_id: t.id, code: 'EARLYBIRD10',
    discount_type: 'percent', discount_value: 10, max_uses: 20, uses_count: 4,
    expires_at: '2026-07-20T00:00:00Z',
  });
}

// ── 4. Open registration, multi-day ────────────────────────────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'phang-nga-challenger-2026', organizer_id: ORGANIZER_ID,
    title: 'Phang Nga Challenger 2026', location: 'Nang Thong Beach, Phang Nga',
    start_date: '2026-08-02', end_date: '2026-08-03', is_one_day: false, phase: 3,
    description: 'Two-day challenger series — registration in progress.',
  };
  tournaments.push(t);
  const open3v3 = addDivision(t.id, { name: 'Open 3v3', format: '3v3', fee: 600, cap: 12 });
  addTeams(open3v3, 5, { startIndex: 20 });
}

// ── 5. Registration closed, upcoming (full bracket scheduled, not started) ─
{
  const t = {
    id: nextId('tournament'), slug: 'bang-niang-beach-classic-2026', organizer_id: ORGANIZER_ID,
    title: 'Bang Niang Beach Classic 2026', location: 'Bang Niang Beach, Khao Lak',
    start_date: '2026-07-12', end_date: '2026-07-13', is_one_day: false, phase: 4,
    description: 'Registration closed — bracket seeded, event starts soon.',
  };
  tournaments.push(t);
  const men = addDivision(t.id, { name: "Men's Open", format: '2v2', fee: 500, cap: 8 });
  const women = addDivision(t.id, { name: "Women's Open", format: '2v2', fee: 500, cap: 8 });
  const mixed = addDivision(t.id, { name: 'Mixed', format: '4v4', fee: 700, cap: 8 });
  const menTeams = addTeams(men, 8, { startIndex: 30 });
  addTeams(women, 6, { startIndex: 40 });
  addTeams(mixed, 6, { startIndex: 50 });

  const qf = addRound(men, 1, 'single', 'QF');
  const times = ['09:00', '10:00', '11:00', '12:00'];
  for (let i = 0; i < 4; i++) {
    addMatch(qf, men, {
      court: `Court ${i + 1}`, time: `2026-07-12T${times[i]}:00+07:00`,
      teamA: menTeams[i * 2], teamB: menTeams[i * 2 + 1],
      status: 'upcoming',
    });
  }
}

// ── 6. Live today ───────────────────────────────────────────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'summer-volleyball-festival-2026', organizer_id: ORGANIZER_ID,
    title: 'Summer Volleyball Festival 2026', location: 'Khuk Khak Beach, Khao Lak',
    start_date: '2026-07-02', end_date: '2026-07-02', is_one_day: true, phase: 4,
    description: "Today's flagship one-day festival — matches underway.",
  };
  tournaments.push(t);
  const men = addDivision(t.id, { name: "Men's Open", format: '2v2', fee: 500, cap: 8 });
  const women = addDivision(t.id, { name: "Women's Open", format: '2v2', fee: 500, cap: 8 });
  const menTeams = addTeams(men, 8, { startIndex: 60 });
  const womenTeams = addTeams(women, 8, { startIndex: 70 });
  menTeams.forEach((teamId) => addPlayers(teamId, 2));
  womenTeams.forEach((teamId) => addPlayers(teamId, 2));

  const menQf = addRound(men, 1, 'single', 'QF');
  addMatch(menQf, men, { court: 'Court 1', time: '2026-07-02T09:00:00+07:00', teamA: menTeams[0], teamB: menTeams[1], scoreA: [21, 15], scoreB: [18, 12], winner: menTeams[0], status: 'done' });
  addMatch(menQf, men, { court: 'Court 2', time: '2026-07-02T09:00:00+07:00', teamA: menTeams[2], teamB: menTeams[3], scoreA: [21, 21], scoreB: [17, 19], winner: menTeams[2], status: 'done' });
  addMatch(menQf, men, {
    court: 'Court 3', time: '2026-07-02T09:30:00+07:00', teamA: menTeams[4], teamB: menTeams[5],
    scoreA: [21], scoreB: [16], status: 'live',
    liveSnapshot: { setScores: [{ a: 21, b: 16 }], currentScore: { a: 8, b: 6 }, elapsedSeconds: 640 },
  });
  addMatch(menQf, men, { court: 'Court 4', time: '2026-07-02T10:00:00+07:00', teamA: menTeams[6], teamB: menTeams[7], status: 'upcoming' });

  const womenQf = addRound(women, 1, 'single', 'QF');
  addMatch(womenQf, women, { court: 'Court 1', time: '2026-07-02T09:00:00+07:00', teamA: womenTeams[0], teamB: womenTeams[1], scoreA: [21, 21], scoreB: [14, 18], winner: womenTeams[0], status: 'done' });
  addMatch(womenQf, women, { court: 'Court 2', time: '2026-07-02T09:00:00+07:00', teamA: womenTeams[2], teamB: womenTeams[3], scoreA: [21, 21], scoreB: [12, 17], winner: womenTeams[2], status: 'done' });
  addMatch(womenQf, women, { court: 'Court 3', time: '2026-07-02T09:30:00+07:00', teamA: womenTeams[4], teamB: womenTeams[5], scoreA: [21, 21], scoreB: [19, 20], winner: womenTeams[4], status: 'done' });
  addMatch(womenQf, women, {
    court: 'Court 4', time: '2026-07-02T09:45:00+07:00', teamA: womenTeams[6], teamB: womenTeams[7],
    scoreA: [15], scoreB: [11], status: 'live',
    liveSnapshot: { setScores: [], currentScore: { a: 15, b: 11 }, elapsedSeconds: 480 },
  });

  vouchers.push({
    id: nextId('voucher'), tournament_id: t.id, code: 'GAMEDAY',
    discount_type: 'flat', discount_value: 100, max_uses: 50, uses_count: 16,
    expires_at: '2026-07-02T23:59:59+07:00',
  });
}

// ── 7. Finished / past — full results, champion decided ───────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'similan-beach-series-2026', organizer_id: ORGANIZER_ID,
    title: 'Similan Beach Series 2026', location: 'Khuk Khak Beach, Khao Lak',
    start_date: '2026-05-10', end_date: '2026-05-11', is_one_day: false, phase: 4,
    description: 'Completed — final results and champion recorded.',
  };
  tournaments.push(t);
  const div = addDivision(t.id, { name: 'Open 6v6', format: '6v6', fee: 1200, cap: 6 });
  const [a, b, c, d] = addTeams(div, 4, { startIndex: 80 });

  const sf = addRound(div, 1, 'single', 'SF');
  addMatch(sf, div, { court: 'Center Court', time: '2026-05-10T09:00:00+07:00', teamA: a, teamB: d, scoreA: [21, 21], scoreB: [17, 19], winner: a, status: 'done' });
  addMatch(sf, div, { court: 'Center Court', time: '2026-05-10T10:30:00+07:00', teamA: b, teamB: c, scoreA: [19, 21, 15], scoreB: [21, 18, 12], winner: b, status: 'done' });

  const final = addRound(div, 2, 'single', 'Final');
  addMatch(final, div, { court: 'Center Court', time: '2026-05-11T11:00:00+07:00', teamA: a, teamB: b, scoreA: [21, 21], scoreB: [16, 19], winner: a, status: 'done' });
}

// ── 8. Full division + waitlist edge case ──────────────────────────────────
{
  const t = {
    id: nextId('tournament'), slug: 'khao-lak-masters-cup-2026', organizer_id: ORGANIZER_ID,
    title: 'Khao Lak Masters Cup 2026', location: 'Nang Thong Beach, Khao Lak',
    start_date: '2026-07-30', end_date: '2026-07-30', is_one_day: true, phase: 3,
    description: 'Masters division — registration full, waitlist open.',
  };
  tournaments.push(t);
  const masters = addDivision(t.id, { name: 'Masters 4v4', format: '4v4', fee: 900, cap: 6 });
  addTeams(masters, 9, { startIndex: 90, waitlistFrom: 6 });
}

async function insertAll(table, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  console.log(`Inserted ${rows.length} rows into ${table}`);
}

await insertAll('organizers', organizers);
await insertAll('tournaments', tournaments);
await insertAll('divisions', divisions);
await insertAll('rounds', rounds);
await insertAll('teams', teams);
await insertAll('players', players);
await insertAll('registrations', registrations);
await insertAll('matches', matches);
await insertAll('vouchers', vouchers);

console.log('\nSeed complete:', tournaments.length, 'tournaments,', divisions.length, 'divisions,',
  teams.length, 'teams,', matches.length, 'matches.');

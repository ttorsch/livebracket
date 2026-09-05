// Golden template tournament seed script. Run with:
//   node --env-file=.env.local scripts/seed-golden-template.mjs
// Seeds the 2-day, 3-division (~24 teams) mid-play event specified in docs/launch-kit.md.
// Marks the tournament with is_template: true (and slug: andaman-beach-masters-template)
// so the demo clone engine can deep-copy it for incoming visitors.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Deterministic prefix for golden template entities
const TYPE = {
  organizer: 1, tournament: 2, division: 3, round: 4,
  team: 5, match: 6, player: 7, voucher: 8, registration: 9,
};
const id = (type, n) => `99999999-9999-4000-8000-${String(TYPE[type]).padStart(4, '0')}${String(n).padStart(8, '0')}`;

let counters = { organizer: 0, tournament: 0, division: 0, round: 0, team: 0, match: 0, player: 0, voucher: 0, registration: 0 };
const nextId = (type) => id(type, ++counters[type]);
const randomToken = () => crypto.randomBytes(16).toString('hex');

const TEMPLATE_SLUG = 'andaman-beach-masters-template';

const FIRST = [
  'Ananda', 'Somchai', 'Chalermsak', 'Nattapong', 'Kittipong', 'Preecha', 'Wichai', 'Anucha',
  'Thiago', 'Lucas', 'Gabriel', 'Mateus', 'Rafael', 'Bruno', 'Rodrigo', 'Felipe',
  'Kanya', 'Siriporn', 'Malai', 'Sunisa', 'Apinya', 'Duangkamol', 'Rattana', 'Pornthip',
  'Larissa', 'Juliana', 'Camila', 'Beatriz', 'Mariana', 'Fernanda', 'Carolina', 'Amanda'
];
const SECOND = [
  'Suwan', 'Boonmee', 'Charoen', 'Rattana', 'Wattana', 'Pornsak', 'Thongchai', 'Kaewta',
  'Silva', 'Santos', 'Ferreira', 'Oliveira', 'Souza', 'Rodrigues', 'Costa', 'Alves',
  'Chaiyaphum', 'Prasert', 'Srisai', 'Ketsarin', 'Nakhon', 'Wongsuwan', 'Suksom', 'Petchpradab',
  'Pereira', 'Gomes', 'Martins', 'Araujo', 'Cardoso', 'Barbosa', 'Ribeiro', 'Carvalho'
];

function teamName(i) {
  return `${FIRST[i % FIRST.length]} / ${SECOND[(i * 5 + 3) % SECOND.length]}`;
}

export async function buildGoldenTemplate() {
  counters = { organizer: 0, tournament: 0, division: 0, round: 0, team: 0, match: 0, player: 0, voucher: 0, registration: 0 };

  // 1. Organizer for the template
  const organizerId = nextId('organizer');
  const organizer = {
    id: organizerId,
    auth_user_id: null,
    email: 'template.organizer@livebracket.app',
    name: 'Thana Sirichai',
    club: 'Khao Lak Volley Club',
    hometown: 'Khao Lak, Thailand',
  };

  // 2. Tournament (Two days, 3 divisions, mid-play)
  const now = new Date();
  const day1 = now.toISOString().slice(0, 10);
  const day2Date = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const day2 = day2Date.toISOString().slice(0, 10);

  const tournamentId = nextId('tournament');
  const tournament = {
    id: tournamentId,
    slug: TEMPLATE_SLUG,
    organizer_id: organizerId,
    title: 'Andaman Beach Masters 2026',
    location: 'Memories Beach, Khao Lak',
    start_date: day1,
    end_date: day2,
    is_one_day: false,
    phase: 4, // draw locked & scheduled, live matches in progress
    description: 'Flagship 2-day invitational featuring Open Men 2v2, Open Women 2v2, and Mixed 4v4 on Khao Lak sand.',
    is_template: true,
    schedule_config: {
      startTime: '09:00',
      endTime: '18:00',
      courtCount: 4,
      blockMinutes: 45,
      lunchStart: '12:30',
      lunchEnd: '13:30',
      netBufferMinutes: 15,
      courts: [
        { name: 'Court 1', isShowCourt: true, netHeight: 'men' },
        { name: 'Court 2', isShowCourt: false, netHeight: 'women' },
        { name: 'Court 3', isShowCourt: false, netHeight: 'coed' },
        { name: 'Court 4', isShowCourt: false, netHeight: 'men' },
      ],
    },
  };

  const divisions = [];
  const rounds = [];
  const teams = [];
  const players = [];
  const registrations = [];
  const matches = [];
  const vouchers = [];

  function addDivision({ name, format, fee, cap }) {
    const divId = nextId('division');
    divisions.push({
      id: divId,
      tournament_id: tournamentId,
      name,
      format_type_on_sand: format,
      registration_fee: fee,
      division_team_cap: cap,
      scoring_rules: { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
      reg_fields: [
        { key: 'playerName', label: 'Player name', type: 'text', required: true },
        { key: 'phone', label: 'Phone', type: 'text', required: true },
        { key: 'shirt', label: 'Shirt size', type: 'select', options: ['S', 'M', 'L', 'XL'], required: false },
      ],
      settings: { schedule: { courtCount: 4 } },
    });
    return divId;
  }

  function addTeams(divisionId, count, startIndex, playersPerTeam = 2) {
    const ids = [];
    const divFee = divisions.find(d => d.id === divisionId)?.registration_fee ?? 800;
    for (let i = 0; i < count; i++) {
      const teamId = nextId('team');
      const idx = startIndex + i;
      const tName = formatTeamLabel(idx, playersPerTeam);
      teams.push({
        id: teamId,
        division_id: divisionId,
        name: tName,
        seed: i + 1,
        payment_cleared: true,
        status: 'confirmed',
      });
      registrations.push({
        id: nextId('registration'),
        division_id: divisionId,
        team_id: teamId,
        payment_status: 'cleared',
        amount_paid: divFee,
        submitted_at: new Date(Date.now() - (10 - i) * 86400000).toISOString(),
      });
      for (let p = 0; p < playersPerTeam; p++) {
        players.push({
          id: nextId('player'),
          team_id: teamId,
          name: `${FIRST[(idx * 2 + p) % FIRST.length]} ${SECOND[(idx * 3 + p) % SECOND.length]}`,
          phone: `08${String(10000000 + idx * 10 + p).slice(0, 8)}`,
          email: null,
          shirt_size: ['M', 'L', 'XL', 'S'][(idx + p) % 4],
          user_id: null,
          invite_status: 'none',
        });
      }
      ids.push(teamId);
    }
    return ids;
  }

  function formatTeamLabel(idx, playersPerTeam) {
    if (playersPerTeam === 4) {
      const f1 = FIRST[idx % FIRST.length];
      return `${f1} Crew 4v4`;
    }
    return `${FIRST[idx % FIRST.length]} / ${SECOND[(idx * 5 + 3) % SECOND.length]}`;
  }

  function addRound(divisionId, sequence, format, name) {
    const roundId = nextId('round');
    rounds.push({ id: roundId, division_id: divisionId, sequence, format, name });
    return roundId;
  }

  function addMatch(roundId, divisionId, {
    court, time, teamA, teamB, scoreA = null, scoreB = null, winner = null, status = 'upcoming', liveSnapshot = null
  }) {
    const matchId = nextId('match');
    matches.push({
      id: matchId,
      round_id: roundId,
      division_id: divisionId,
      court,
      scheduled_time: time,
      planned_time: time,
      team_a_id: teamA,
      team_b_id: teamB,
      score_a: scoreA,
      score_b: scoreB,
      winner_team_id: winner,
      status,
      live_snapshot: liveSnapshot,
      scorekeeper_token: randomToken(),
      updated_at: new Date().toISOString(),
    });
    return matchId;
  }

  // ── DIVISION 1: Men's Open (2v2) ── 8 Teams
  const menDiv = addDivision({ name: "Men's Open", format: '2v2', fee: 800, cap: 8 });
  const menTeams = addTeams(menDiv, 8, 0, 2);

  // Pool Play (Round 1)
  const menPoolRound = addRound(menDiv, 1, 'round-robin', 'Pool Play');
  // Pool A (0, 1, 2, 3)
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T09:00:00+07:00`, teamA: menTeams[0], teamB: menTeams[1], scoreA: [21, 21], scoreB: [18, 19], winner: menTeams[0], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T09:45:00+07:00`, teamA: menTeams[2], teamB: menTeams[3], scoreA: [21, 19, 15], scoreB: [17, 21, 11], winner: menTeams[2], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T10:30:00+07:00`, teamA: menTeams[0], teamB: menTeams[2], scoreA: [21, 21], scoreB: [15, 16], winner: menTeams[0], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T11:15:00+07:00`, teamA: menTeams[1], teamB: menTeams[3], scoreA: [21, 21], scoreB: [12, 14], winner: menTeams[1], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T13:30:00+07:00`, teamA: menTeams[0], teamB: menTeams[3], scoreA: [21, 21], scoreB: [14, 15], winner: menTeams[0], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 1', time: `${day1}T14:15:00+07:00`, teamA: menTeams[1], teamB: menTeams[2], scoreA: [21, 21], scoreB: [17, 19], winner: menTeams[1], status: 'done' });

  // Pool B (4, 5, 6, 7)
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T09:00:00+07:00`, teamA: menTeams[4], teamB: menTeams[5], scoreA: [21, 21], scoreB: [16, 17], winner: menTeams[4], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T09:45:00+07:00`, teamA: menTeams[6], teamB: menTeams[7], scoreA: [21, 21], scoreB: [19, 18], winner: menTeams[6], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T10:30:00+07:00`, teamA: menTeams[4], teamB: menTeams[6], scoreA: [21, 21], scoreB: [13, 14], winner: menTeams[4], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T11:15:00+07:00`, teamA: menTeams[5], teamB: menTeams[7], scoreA: [21, 21], scoreB: [15, 12], winner: menTeams[5], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T13:30:00+07:00`, teamA: menTeams[4], teamB: menTeams[7], scoreA: [21, 21], scoreB: [11, 10], winner: menTeams[4], status: 'done' });
  addMatch(menPoolRound, menDiv, { court: 'Court 4', time: `${day1}T14:15:00+07:00`, teamA: menTeams[5], teamB: menTeams[6], scoreA: [21, 22], scoreB: [19, 20], winner: menTeams[5], status: 'done' });

  // Semifinals (Round 2)
  const menSfRound = addRound(menDiv, 2, 'single', 'Semifinals');
  // Match 1: LIVE NOW on Court 1!
  addMatch(menSfRound, menDiv, {
    court: 'Court 1',
    time: `${day1}T15:00:00+07:00`,
    teamA: menTeams[0], // Pool A Winner
    teamB: menTeams[5], // Pool B Runner-up
    scoreA: [21],
    scoreB: [18],
    status: 'live',
    liveSnapshot: {
      setScores: [{ a: 21, b: 18 }],
      currentScore: { a: 15, b: 13 },
      elapsedSeconds: 1420,
    },
  });
  // Match 2: Upcoming on Court 1
  addMatch(menSfRound, menDiv, {
    court: 'Court 1',
    time: `${day1}T16:00:00+07:00`,
    teamA: menTeams[4], // Pool B Winner
    teamB: menTeams[1], // Pool A Runner-up
    status: 'upcoming',
  });

  // Final (Round 3) - Day 2
  const menFinalRound = addRound(menDiv, 3, 'single', 'Final');
  addMatch(menFinalRound, menDiv, {
    court: 'Court 1',
    time: `${day2}T11:00:00+07:00`,
    teamA: menTeams[0],
    teamB: null,
    status: 'upcoming',
  });

  // ── DIVISION 2: Women's Open (2v2) ── 8 Teams
  const womenDiv = addDivision({ name: "Women's Open", format: '2v2', fee: 800, cap: 8 });
  const womenTeams = addTeams(womenDiv, 8, 8, 2);

  // Pool Play (Round 1)
  const womenPoolRound = addRound(womenDiv, 1, 'round-robin', 'Pool Play');
  // 6 Pool A matches (8,9,10,11)
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T09:00:00+07:00`, teamA: womenTeams[0], teamB: womenTeams[1], scoreA: [21, 21], scoreB: [15, 17], winner: womenTeams[0], status: 'done' });
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T09:45:00+07:00`, teamA: womenTeams[2], teamB: womenTeams[3], scoreA: [21, 21], scoreB: [16, 14], winner: womenTeams[2], status: 'done' });
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T10:30:00+07:00`, teamA: womenTeams[0], teamB: womenTeams[2], scoreA: [21, 21], scoreB: [19, 18], winner: womenTeams[0], status: 'done' });
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T11:15:00+07:00`, teamA: womenTeams[1], teamB: womenTeams[3], scoreA: [21, 21], scoreB: [10, 12], winner: womenTeams[1], status: 'done' });
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T13:30:00+07:00`, teamA: womenTeams[0], teamB: womenTeams[3], scoreA: [21, 21], scoreB: [9, 11], winner: womenTeams[0], status: 'done' });
  addMatch(womenPoolRound, womenDiv, { court: 'Court 2', time: `${day1}T14:15:00+07:00`, teamA: womenTeams[1], teamB: womenTeams[2], scoreA: [21, 21], scoreB: [17, 18], winner: womenTeams[1], status: 'done' });

  // Semifinals (Round 2)
  const womenSfRound = addRound(womenDiv, 2, 'single', 'Semifinals');
  // Match 1: Done
  addMatch(womenSfRound, womenDiv, {
    court: 'Court 2',
    time: `${day1}T15:00:00+07:00`,
    teamA: womenTeams[0],
    teamB: womenTeams[5],
    scoreA: [21, 21],
    scoreB: [16, 17],
    winner: womenTeams[0],
    status: 'done',
  });
  // Match 2: LIVE NOW on Court 2! (3rd set thriller!)
  addMatch(womenSfRound, womenDiv, {
    court: 'Court 2',
    time: `${day1}T15:45:00+07:00`,
    teamA: womenTeams[4],
    teamB: womenTeams[1],
    scoreA: [19, 21],
    scoreB: [21, 18],
    status: 'live',
    liveSnapshot: {
      setScores: [{ a: 19, b: 21 }, { a: 21, b: 18 }],
      currentScore: { a: 9, b: 7 },
      elapsedSeconds: 2180,
    },
  });

  // Final (Round 3) - Day 2
  const womenFinalRound = addRound(womenDiv, 3, 'single', 'Final');
  addMatch(womenFinalRound, womenDiv, {
    court: 'Court 2',
    time: `${day2}T10:00:00+07:00`,
    teamA: womenTeams[0],
    teamB: null,
    status: 'upcoming',
  });

  // ── DIVISION 3: Mixed 4v4 ── 8 Teams
  const mixedDiv = addDivision({ name: 'Mixed 4v4', format: '4v4', fee: 1200, cap: 8 });
  const mixedTeams = addTeams(mixedDiv, 8, 16, 4);

  // Single Elimination Quarterfinals (Round 1)
  const mixedQfRound = addRound(mixedDiv, 1, 'single', 'Quarterfinals');
  addMatch(mixedQfRound, mixedDiv, { court: 'Court 3', time: `${day1}T09:30:00+07:00`, teamA: mixedTeams[0], teamB: mixedTeams[1], scoreA: [21, 21], scoreB: [14, 16], winner: mixedTeams[0], status: 'done' });
  addMatch(mixedQfRound, mixedDiv, { court: 'Court 3', time: `${day1}T10:30:00+07:00`, teamA: mixedTeams[2], teamB: mixedTeams[3], scoreA: [21, 18, 15], scoreB: [19, 21, 12], winner: mixedTeams[2], status: 'done' });
  addMatch(mixedQfRound, mixedDiv, { court: 'Court 3', time: `${day1}T11:30:00+07:00`, teamA: mixedTeams[4], teamB: mixedTeams[5], scoreA: [21, 21], scoreB: [17, 19], winner: mixedTeams[4], status: 'done' });
  addMatch(mixedQfRound, mixedDiv, { court: 'Court 3', time: `${day1}T13:30:00+07:00`, teamA: mixedTeams[6], teamB: mixedTeams[7], scoreA: [21, 21], scoreB: [13, 15], winner: mixedTeams[6], status: 'done' });

  // Semifinals (Round 2) - Day 1 Afternoon
  const mixedSfRound = addRound(mixedDiv, 2, 'single', 'Semifinals');
  addMatch(mixedSfRound, mixedDiv, { court: 'Court 3', time: `${day1}T16:00:00+07:00`, teamA: mixedTeams[0], teamB: mixedTeams[2], status: 'upcoming' });
  addMatch(mixedSfRound, mixedDiv, { court: 'Court 3', time: `${day1}T17:00:00+07:00`, teamA: mixedTeams[4], teamB: mixedTeams[6], status: 'upcoming' });

  // Final (Round 3) - Day 2
  const mixedFinalRound = addRound(mixedDiv, 3, 'single', 'Final');
  addMatch(mixedFinalRound, mixedDiv, { court: 'Court 3', time: `${day2}T14:00:00+07:00`, teamA: null, teamB: null, status: 'upcoming' });

  // Vouchers
  vouchers.push({
    id: nextId('voucher'),
    tournament_id: tournamentId,
    code: 'ANDAMAN15',
    discount_type: 'percent',
    discount_value: 15,
    max_uses: 20,
    uses_count: 6,
    expires_at: `${day2}T23:59:59+07:00`,
  });
  vouchers.push({
    id: nextId('voucher'),
    tournament_id: tournamentId,
    code: 'BEACH2026',
    discount_type: 'flat',
    discount_value: 100,
    max_uses: 50,
    uses_count: 14,
    expires_at: `${day2}T23:59:59+07:00`,
  });

  return {
    organizers: [organizer],
    tournaments: [tournament],
    divisions,
    rounds,
    teams,
    players,
    registrations,
    matches,
    vouchers,
  };
}

async function insertAll(table, rows) {
  if (!rows || rows.length === 0) return;
  // If table is tournaments and is_template column doesn't exist yet in db, remove it gracefully on error
  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    if (table === 'tournaments' && error.message.includes('is_template')) {
      console.warn('is_template column not found, inserting without is_template column');
      const stripped = rows.map(({ is_template, ...rest }) => rest);
      const { error: err2 } = await supabase.from(table).insert(stripped);
      if (err2) throw new Error(`Insert into ${table} failed: ${err2.message}`);
      console.log(`Inserted ${rows.length} rows into ${table} (without is_template)`);
      return;
    }
    throw new Error(`Insert into ${table} failed: ${error.message}`);
  }
  console.log(`Inserted ${rows.length} rows into ${table}`);
}

async function cleanupExistingTemplate() {
  const { data: existing } = await supabase
    .from('tournaments')
    .select('id')
    .eq('slug', TEMPLATE_SLUG)
    .maybeSingle();

  if (existing) {
    console.log(`Cleaning up existing template tournament (${existing.id})...`);
    // Cascade delete takes care of divisions, rounds, teams, players, matches, vouchers
    const { error } = await supabase.from('tournaments').delete().eq('id', existing.id);
    if (error) console.warn('Could not delete old template:', error.message);
  }

  // Also clean up template organizer if exists
  await supabase.from('organizers').delete().eq('email', 'template.organizer@livebracket.app');
}

async function main() {
  console.log('Building Golden Template dataset...');
  const data = await buildGoldenTemplate();

  console.log('Cleaning up any previous template...');
  await cleanupExistingTemplate();

  console.log('Seeding golden template to Supabase...');
  await insertAll('organizers', data.organizers);
  await insertAll('tournaments', data.tournaments);
  await insertAll('divisions', data.divisions);
  await insertAll('rounds', data.rounds);
  await insertAll('teams', data.teams);
  await insertAll('players', data.players);
  await insertAll('registrations', data.registrations);
  await insertAll('matches', data.matches);
  await insertAll('vouchers', data.vouchers);

  console.log('\nGolden template successfully seeded:');
  console.log(`- Tournament: ${data.tournaments[0].title} (${TEMPLATE_SLUG})`);
  console.log(`- Divisions: ${data.divisions.length} (Men's Open, Women's Open, Mixed 4v4)`);
  console.log(`- Teams: ${data.teams.length}`);
  console.log(`- Players: ${data.players.length}`);
  console.log(`- Matches: ${data.matches.length} (including 2 live matches)`);
  console.log(`- Vouchers: ${data.vouchers.length}`);
}

// Allow importing or running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal seed error:', err);
    process.exit(1);
  });
}

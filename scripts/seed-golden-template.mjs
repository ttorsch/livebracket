// Golden template tournament seed script. Run with:
//   node --env-file=.env.local scripts/seed-golden-template.mjs
// Seeds the 2-day, 3-division (~24 teams) mid-play event specified in docs/launch-kit.md,
// updated with organizer customizations (caps, scoring rules, FIVB settings, and durations).
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
  'Larissa', 'Juliana', 'Camila', 'Beatriz', 'Mariana', 'Fernanda', 'Carolina', 'Amanda',
  'Tawan', 'Arthit', 'Chai', 'Nat', 'Korn', 'Danai', 'Phawat', 'Leo'
];
const SECOND = [
  'Suwan', 'Boonmee', 'Charoen', 'Rattana', 'Wattana', 'Pornsak', 'Thongchai', 'Kaewta',
  'Silva', 'Santos', 'Ferreira', 'Oliveira', 'Souza', 'Rodrigues', 'Costa', 'Alves',
  'Chaiyaphum', 'Prasert', 'Srisai', 'Ketsarin', 'Nakhon', 'Wongsuwan', 'Suksom', 'Petchpradab',
  'Pereira', 'Gomes', 'Martins', 'Araujo', 'Cardoso', 'Barbosa', 'Ribeiro', 'Carvalho',
  'Jaroensuk', 'Kulap', 'Phromthep', 'Suphaphon', 'Tantrakul', 'Vichit', 'Siriwong', 'Kasem'
];

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
  const regCloseDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

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

  function addDivision({ name, format, fee, cap, settings = {}, scoring_rules }) {
    const divId = nextId('division');
    divisions.push({
      id: divId,
      tournament_id: tournamentId,
      name,
      format_type_on_sand: format,
      registration_fee: fee,
      division_team_cap: cap,
      scoring_rules: scoring_rules ?? { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
      reg_fields: [
        { key: 'playerName', label: 'Player name', type: 'text', required: true },
        { key: 'phone', label: 'Phone', type: 'text', required: true },
        { key: 'shirt', label: 'Shirt size', type: 'select', options: ['S', 'M', 'L', 'XL'], required: false },
      ],
      settings: {
        rules: 'Standard FIVB Beach Volleyball rules apply.',
        ageLimit: '',
        crossing: 'fivb',
        currency: 'THB',
        minTeams: 4,
        netHeight: '2.24m',
        prizePool: '',
        allowMulti: true,
        waitlistCap: 5,
        confirmationImage: '',
        genderEligibility: 'Anyone',
        confirmationMessage: '',
        registrationOpenDate: day1,
        registrationCloseDate: regCloseDate,
        ...settings,
        schedule: { courtCount: 4 },
      },
    });
    return divId;
  }

  function addTeams(divisionId, count, startIndex, playersPerTeam = 2, waitlistCount = 0) {
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
        submitted_at: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
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
    for (let w = 0; w < waitlistCount; w++) {
      const teamId = nextId('team');
      const idx = startIndex + count + w;
      const tName = formatTeamLabel(idx, playersPerTeam);
      teams.push({
        id: teamId,
        division_id: divisionId,
        name: tName,
        seed: count + w + 1,
        payment_cleared: false,
        status: 'waitlist',
      });
      registrations.push({
        id: nextId('registration'),
        division_id: divisionId,
        team_id: teamId,
        payment_status: 'pending',
        amount_paid: 0,
        submitted_at: new Date(Date.now() - (5 - w) * 86400000).toISOString(),
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

  function addRound(divisionId, sequence, format, name, scoring_rules = null) {
    const roundId = nextId('round');
    rounds.push({ id: roundId, division_id: divisionId, sequence, format, name, scoring_rules });
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

  // ── DIVISION 1: Men's Open (2v2) ── Cap 16 (16 confirmed + 2 waitlist)
  const menScoringR1 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, durationMinutes: 30, decidingSetPoints: 11 };
  const menScoringR2 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 21, durationMinutes: 45, decidingSetPoints: 15 };

  const menDiv = addDivision({
    name: "Men's Open",
    format: '2v2',
    fee: 800,
    cap: 16,
    scoring_rules: { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
    settings: {
      advancePerPool: 2,
      maxRosterSize: 2,
      formatRounds: [
        { format: 'round-robin', scoring: menScoringR1, durationMinutes: 30 },
        { format: 'single', scoring: menScoringR2, durationMinutes: 45 }
      ],
    }
  });
  const menTeams = addTeams(menDiv, 16, 0, 2, 2);

  // Pool Play (Round 1) & Knockout (Round 2) - Matches left blank for tuning
  addRound(menDiv, 1, 'round-robin', 'Round 1', menScoringR1);
  addRound(menDiv, 2, 'single', 'Round 2', menScoringR2);

  // ── DIVISION 2: Women's Open (2v2) ── Cap 12 (12 confirmed)
  const womenScoringR1 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, durationMinutes: 30, decidingSetPoints: 11 };
  const womenScoringR2 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 21, durationMinutes: 45, decidingSetPoints: 15 };

  const womenDiv = addDivision({
    name: "Women's Open",
    format: '2v2',
    fee: 800,
    cap: 12,
    scoring_rules: { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
    settings: {
      advancePerPool: 3,
      maxRosterSize: 2,
      formatRounds: [
        { format: 'round-robin', scoring: womenScoringR1, durationMinutes: 30 },
        { format: 'single', scoring: womenScoringR2, durationMinutes: 45 }
      ],
    }
  });
  const womenTeams = addTeams(womenDiv, 12, 18, 2, 0);

  // Pool Play (Round 1) & Knockout (Round 2) - Matches left blank for tuning
  addRound(womenDiv, 1, 'round-robin', 'Round 1', womenScoringR1);
  addRound(womenDiv, 2, 'single', 'Round 2', womenScoringR2);

  // ── DIVISION 3: Mixed 4v4 ── Cap 8 (8 confirmed, maxRosterSize: 6)
  const mixedScoringR1 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, durationMinutes: 45, decidingSetPoints: 11 };
  const mixedScoringR2 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 21, durationMinutes: 60, decidingSetPoints: 15 };

  const mixedDiv = addDivision({
    name: 'Mixed 4v4',
    format: '4v4',
    fee: 1200,
    cap: 8,
    scoring_rules: { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
    settings: {
      advancePerPool: 2,
      maxRosterSize: 6,
      formatRounds: [
        { format: 'round-robin', scoring: mixedScoringR1, durationMinutes: 45 },
        { format: 'single', scoring: mixedScoringR2, durationMinutes: 60 }
      ],
    }
  });
  const mixedTeams = addTeams(mixedDiv, 8, 30, 4, 0);

  // Round 1 (Round-robin) & Round 2 (Single Elimination) - Matches left blank for tuning
  addRound(mixedDiv, 1, 'round-robin', 'Round 1', mixedScoringR1);
  addRound(mixedDiv, 2, 'single', 'Round 2', mixedScoringR2);

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
    const { error } = await supabase.from('tournaments').delete().eq('id', existing.id);
    if (error) console.warn('Could not delete old template:', error.message);
  }

  // Also clean up template organizer if exists
  await supabase.from('organizers').delete().eq('email', 'template.organizer@livebracket.app');
}

async function main() {
  console.log('Building Golden Template dataset with adjusted settings...');
  const data = await buildGoldenTemplate();

  console.log('Cleaning up any previous template...');
  await cleanupExistingTemplate();

  console.log('Seeding updated golden template to Supabase...');
  await insertAll('organizers', data.organizers);
  await insertAll('tournaments', data.tournaments);
  await insertAll('divisions', data.divisions);
  await insertAll('rounds', data.rounds);
  await insertAll('teams', data.teams);
  await insertAll('players', data.players);
  await insertAll('registrations', data.registrations);
  await insertAll('matches', data.matches);
  await insertAll('vouchers', data.vouchers);

  console.log('\nGolden template successfully updated:');
  console.log(`- Tournament: ${data.tournaments[0].title} (${TEMPLATE_SLUG})`);
  console.log(`- Divisions: ${data.divisions.length} (Men's Open cap 16, Women's Open cap 12, Mixed 4v4 cap 8 with roster 6)`);
  console.log(`- Teams: ${data.teams.length} (${data.teams.filter(t => t.status === 'confirmed').length} confirmed, ${data.teams.filter(t => t.status === 'waitlist').length} waitlist)`);
  console.log(`- Players: ${data.players.length}`);
  console.log(`- Matches: ${data.matches.length} (blank / ready for user tuning)`);
  console.log(`- Vouchers: ${data.vouchers.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal seed error:', err);
    process.exit(1);
  });
}

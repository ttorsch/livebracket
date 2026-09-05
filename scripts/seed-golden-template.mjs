// Golden template tournament seed script. Run with:
//   node --env-file=.env.local scripts/seed-golden-template.mjs
// Seeds two template events:
//   1. Andaman Beach Masters 2026 (Live mid-play event with 84 scheduled matches, 16 rounds across 3 divisions, draw locked).
//   2. Khao Lak Beach Open 2026 (Upcoming future event with 5 divisions: 3 full registration with 0 matches ready for tuning, plus 2 announced divisions).

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Deterministic prefix for golden template entities
const TYPE = {
  organizer: 1, tournament: 2, division: 3, round: 4,
  team: 5, match: 6, player: 7, voucher: 8, registration: 9,
};
const id = (type, n) => `99999999-9999-4000-8000-${String(TYPE[type]).padStart(4, "0")}${String(n).padStart(8, "0")}`;

let counters = { organizer: 0, tournament: 0, division: 0, round: 0, team: 0, match: 0, player: 0, voucher: 0, registration: 0 };
const nextId = (type) => id(type, ++counters[type]);
const randomToken = () => crypto.randomBytes(16).toString("hex");

const TEMPLATE_SLUG_1 = "andaman-beach-masters-template";
const TEMPLATE_SLUG_2 = "khao-lak-beach-open-template";

const FIRST = [
  "Ananda", "Somchai", "Chalermsak", "Nattapong", "Kittipong", "Preecha", "Wichai", "Anucha",
  "Thiago", "Lucas", "Gabriel", "Mateus", "Rafael", "Bruno", "Rodrigo", "Felipe",
  "Kanya", "Siriporn", "Malai", "Sunisa", "Apinya", "Duangkamol", "Rattana", "Pornthip",
  "Larissa", "Juliana", "Camila", "Beatriz", "Mariana", "Fernanda", "Carolina", "Amanda",
  "Tawan", "Arthit", "Chai", "Nat", "Korn", "Danai", "Phawat", "Leo"
];
const SECOND = [
  "Suwan", "Boonmee", "Charoen", "Rattana", "Wattana", "Pornsak", "Thongchai", "Kaewta",
  "Silva", "Santos", "Ferreira", "Oliveira", "Souza", "Rodrigues", "Costa", "Alves",
  "Chaiyaphum", "Prasert", "Srisai", "Ketsarin", "Nakhon", "Wongsuwan", "Suksom", "Petchpradab",
  "Pereira", "Gomes", "Martins", "Araujo", "Cardoso", "Barbosa", "Ribeiro", "Carvalho",
  "Jaroensuk", "Kulap", "Phromthep", "Suphaphon", "Tantrakul", "Vichit", "Siriwong", "Kasem"
];

export async function buildGoldenTemplate() {
  counters = { organizer: 0, tournament: 0, division: 0, round: 0, team: 0, match: 0, player: 0, voucher: 0, registration: 0 };

  const organizers = [];
  const tournaments = [];
  const divisions = [];
  const rounds = [];
  const teams = [];
  const players = [];
  const registrations = [];
  const matches = [];
  const vouchers = [];

  const now = new Date();
  const day1 = now.toISOString().slice(0, 10);
  const day2 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1. Template Organizer
  const organizerId = nextId("organizer");
  organizers.push({
    id: organizerId,
    auth_user_id: null,
    email: "template.organizer@livebracket.app",
    name: "Thana Sirichai",
    club: "Khao Lak Volley Club",
    hometown: "Khao Lak, Thailand",
  });

  // ─────────────────────────────────────────────────────────────
  // TOURNAMENT 1: Andaman Beach Masters 2026 (Tuned Live Event)
  // ─────────────────────────────────────────────────────────────
  const tunedPath = new URL("./seed-data/tuned-andaman-masters.json", import.meta.url);
  const tuned = JSON.parse(fs.readFileSync(tunedPath, "utf8"));

  const idMap = new Map();
  const remap = (oldId) => (oldId ? idMap.get(oldId) ?? null : null);

  const t1Id = nextId("tournament");
  idMap.set(tuned.tourney.id, t1Id);

  tournaments.push({
    id: t1Id,
    slug: TEMPLATE_SLUG_1,
    organizer_id: organizerId,
    title: tuned.tourney.title,
    location: tuned.tourney.location || "Memories Beach, Khao Lak",
    start_date: day1,
    end_date: day2,
    is_one_day: false,
    phase: tuned.tourney.phase || 4,
    description: tuned.tourney.description,
    is_template: true,
    schedule_config: tuned.tourney.schedule_config,
  });

  // Divisions for Tournament 1
  for (const d of tuned.divs) {
    const newDivId = nextId("division");
    idMap.set(d.id, newDivId);
    divisions.push({
      ...d,
      id: newDivId,
      tournament_id: t1Id,
    });
  }

  // Rounds for Tournament 1
  for (const r of tuned.rounds) {
    const newRoundId = nextId("round");
    idMap.set(r.id, newRoundId);
    rounds.push({
      ...r,
      id: newRoundId,
      division_id: remap(r.division_id),
    });
  }

  // Teams for Tournament 1
  for (const t of tuned.teams) {
    const newTeamId = nextId("team");
    idMap.set(t.id, newTeamId);
    teams.push({
      ...t,
      id: newTeamId,
      division_id: remap(t.division_id),
      registered_by: null,
    });
  }

  // Players for Tournament 1
  for (const p of tuned.players) {
    const newPlayerId = nextId("player");
    idMap.set(p.id, newPlayerId);
    players.push({
      ...p,
      id: newPlayerId,
      team_id: remap(p.team_id),
      user_id: null,
    });
  }

  // Registrations for Tournament 1
  for (const reg of tuned.regs) {
    const newRegId = nextId("registration");
    registrations.push({
      ...reg,
      id: newRegId,
      division_id: remap(reg.division_id),
      team_id: remap(reg.team_id),
    });
  }

  // Matches for Tournament 1
  const shiftTimeT1 = (tStr) => {
    if (!tStr) return null;
    const isDay2 = tStr.startsWith("2026-09-06");
    const targetDay = isDay2 ? day2 : day1;
    return `${targetDay}${tStr.slice(10)}`;
  };

  for (const m of tuned.matches) {
    const newMatchId = nextId("match");
    idMap.set(m.id, newMatchId);
    matches.push({
      ...m,
      id: newMatchId,
      round_id: remap(m.round_id),
      division_id: remap(m.division_id),
      team_a_id: remap(m.team_a_id),
      team_b_id: remap(m.team_b_id),
      winner_team_id: remap(m.winner_team_id),
      referee_team_id: remap(m.referee_team_id),
      scheduled_time: shiftTimeT1(m.scheduled_time),
      planned_time: shiftTimeT1(m.planned_time),
      scorekeeper_token: randomToken(),
      updated_at: new Date().toISOString(),
    });
  }

  // Remap draw settings in divisions for Tournament 1
  for (const d of divisions.filter(div => div.tournament_id === t1Id)) {
    if (d.settings?.draw) {
      const draw = { ...d.settings.draw };
      if (draw.slots) {
        const nextSlots = {};
        for (const [seq, mids] of Object.entries(draw.slots)) {
          nextSlots[seq] = (mids || []).map(mid => remap(mid) || mid);
        }
        draw.slots = nextSlots;
      }
      if (draw.crossSlots) {
        const nextCross = {};
        for (const [mid, cs] of Object.entries(draw.crossSlots)) {
          nextCross[remap(mid) || mid] = cs;
        }
        draw.crossSlots = nextCross;
      }
      if (draw.loserFeeders) {
        const nextFeeders = {};
        for (const [mid, fids] of Object.entries(draw.loserFeeders)) {
          nextFeeders[remap(mid) || mid] = (fids || []).map(fid => remap(fid) || fid);
        }
        draw.loserFeeders = nextFeeders;
      }
      d.settings = { ...d.settings, draw };
    }
  }

  // Vouchers for Tournament 1
  for (const v of tuned.vouchers) {
    vouchers.push({
      ...v,
      id: nextId("voucher"),
      tournament_id: t1Id,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // TOURNAMENT 2: Khao Lak Beach Open 2026 (Upcoming, Blank Matches)
  // ─────────────────────────────────────────────────────────────
  const t2Id = nextId("tournament");
  const t2Start = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const t2End = new Date(now.getTime() + 15 * 86400000).toISOString().slice(0, 10);

  tournaments.push({
    id: t2Id,
    slug: TEMPLATE_SLUG_2,
    organizer_id: organizerId,
    title: "Khao Lak Beach Open 2026",
    location: "Nang Thong Beach, Khao Lak",
    start_date: t2Start,
    end_date: t2End,
    is_one_day: false,
    phase: 3, // Registration open / Announced
    description: "Annual Khao Lak community beach tournament featuring 5 competitive divisions on the Andaman coast.",
    is_template: true,
    schedule_config: {
      startTime: "09:00",
      endTime: "18:30",
      courtCount: 4,
      blockMinutes: 45,
      lunchStart: "12:30",
      lunchEnd: "13:30",
      netBufferMinutes: 0,
      minRestSlots: 1,
      finalsOnLastDay: true,
      stageFinals: false,
      courts: [
        { name: "Court 1", isShowCourt: true },
        { name: "Court 2" },
        { name: "Court 3" },
        { name: "Court 4" },
      ],
    },
  });

  function addT2Division({ name, format, fee, cap, settings = {}, scoring_rules }) {
    const divId = nextId("division");
    divisions.push({
      id: divId,
      tournament_id: t2Id,
      name,
      format_type_on_sand: format,
      registration_fee: fee,
      division_team_cap: cap,
      scoring_rules: scoring_rules ?? { sets: 3, pointsPerSet: 21, winBy2: true, hardCap: 25 },
      created_at: now.toISOString(),
      reg_fields: [
        { key: "playerName", label: "Player name", type: "text", required: true },
        { key: "phone", label: "Phone", type: "text", required: true },
        { key: "shirt", label: "Shirt size", type: "select", options: ["S", "M", "L", "XL"], required: false },
      ],
      settings: {
        rules: "Standard FIVB Beach Volleyball rules apply.",
        ageLimit: "",
        crossing: "fivb",
        currency: "THB",
        minTeams: 4,
        netHeight: "2.24m",
        prizePool: "",
        allowMulti: true,
        waitlistCap: 5,
        confirmationImage: "",
        genderEligibility: "Anyone",
        confirmationMessage: "",
        registrationOpenDate: day1,
        registrationCloseDate: new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10),
        ...settings,
        schedule: { courtCount: 4 },
      },
    });
    return divId;
  }

  function formatTeamLabel(idx, playersPerTeam) {
    if (playersPerTeam === 4) {
      const f1 = FIRST[idx % FIRST.length];
      return `${f1} Crew 4v4`;
    }
    return `${FIRST[idx % FIRST.length]} / ${SECOND[(idx * 5 + 3) % SECOND.length]}`;
  }

  function addT2Teams(divisionId, count, startIndex, playersPerTeam = 2, waitlistCount = 0) {
    const ids = [];
    const divFee = divisions.find(d => d.id === divisionId)?.registration_fee ?? 800;
    for (let i = 0; i < count; i++) {
      const teamId = nextId("team");
      const idx = startIndex + i;
      const tName = formatTeamLabel(idx, playersPerTeam);
      teams.push({
        id: teamId,
        division_id: divisionId,
        name: tName,
        seed: i + 1,
        payment_cleared: true,
        status: "confirmed",
        created_at: now.toISOString(),
        registered_by: null,
      });
      registrations.push({
        id: nextId("registration"),
        division_id: divisionId,
        team_id: teamId,
        payment_status: "cleared",
        amount_paid: divFee,
        submitted_at: new Date(Date.now() - (15 - i) * 86400000).toISOString(),
      });
      for (let p = 0; p < playersPerTeam; p++) {
        players.push({
          id: nextId("player"),
          team_id: teamId,
          name: `${FIRST[(idx * 2 + p) % FIRST.length]} ${SECOND[(idx * 3 + p) % SECOND.length]}`,
          phone: `08${String(30000000 + idx * 10 + p).slice(0, 8)}`,
          email: null,
          shirt_size: ["M", "L", "XL", "S"][(idx + p) % 4],
          custom_fields: {},
          user_id: null,
          invite_status: "none",
        });
      }
      ids.push(teamId);
    }
    for (let w = 0; w < waitlistCount; w++) {
      const teamId = nextId("team");
      const idx = startIndex + count + w;
      const tName = formatTeamLabel(idx, playersPerTeam);
      teams.push({
        id: teamId,
        division_id: divisionId,
        name: tName,
        seed: count + w + 1,
        payment_cleared: false,
        status: "waitlist",
        created_at: now.toISOString(),
        registered_by: null,
      });
      registrations.push({
        id: nextId("registration"),
        division_id: divisionId,
        team_id: teamId,
        payment_status: "pending",
        amount_paid: 0,
        submitted_at: new Date(Date.now() - (3 - w) * 86400000).toISOString(),
      });
      for (let p = 0; p < playersPerTeam; p++) {
        players.push({
          id: nextId("player"),
          team_id: teamId,
          name: `${FIRST[(idx * 2 + p) % FIRST.length]} ${SECOND[(idx * 3 + p) % SECOND.length]}`,
          phone: `08${String(30000000 + idx * 10 + p).slice(0, 8)}`,
          email: null,
          shirt_size: ["M", "L", "XL", "S"][(idx + p) % 4],
          custom_fields: {},
          user_id: null,
          invite_status: "none",
        });
      }
      ids.push(teamId);
    }
    return ids;
  }

  const scoringR1 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, durationMinutes: 30, decidingSetPoints: 11 };
  const scoringR2 = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 21, durationMinutes: 45, decidingSetPoints: 15 };
  const mixedR1Scoring = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, durationMinutes: 45, decidingSetPoints: 11 };
  const mixedR2Scoring = { winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 21, durationMinutes: 60, decidingSetPoints: 15 };

  // T2 Division 1: Men's Open (Cap 16, full registration + 2 waitlist, 0 matches)
  const t2Men = addT2Division({
    name: "Men's Open",
    format: "2v2",
    fee: 800,
    cap: 16,
    settings: {
      advancePerPool: 2,
      maxRosterSize: 2,
      formatRounds: [
        { format: "round-robin", scoring: scoringR1, durationMinutes: 30 },
        { format: "single", scoring: scoringR2, durationMinutes: 45 }
      ],
    }
  });
  addT2Teams(t2Men, 16, 0, 2, 2);
  rounds.push({ id: nextId("round"), division_id: t2Men, sequence: 1, format: "round-robin", name: "Round 1", scoring_rules: scoringR1 });
  rounds.push({ id: nextId("round"), division_id: t2Men, sequence: 2, format: "single", name: "Round 2", scoring_rules: scoringR2 });

  // T2 Division 2: Women's Open (Cap 12, full registration, 0 matches)
  const t2Women = addT2Division({
    name: "Women's Open",
    format: "2v2",
    fee: 800,
    cap: 12,
    settings: {
      advancePerPool: 3,
      maxRosterSize: 2,
      formatRounds: [
        { format: "round-robin", scoring: scoringR1, durationMinutes: 30 },
        { format: "single", scoring: scoringR2, durationMinutes: 45 }
      ],
    }
  });
  addT2Teams(t2Women, 12, 18, 2, 0);
  rounds.push({ id: nextId("round"), division_id: t2Women, sequence: 1, format: "round-robin", name: "Round 1", scoring_rules: scoringR1 });
  rounds.push({ id: nextId("round"), division_id: t2Women, sequence: 2, format: "single", name: "Round 2", scoring_rules: scoringR2 });

  // T2 Division 3: Mixed 4v4 (Cap 8, full registration, 0 matches)
  const t2Mixed = addT2Division({
    name: "Mixed 4v4",
    format: "4v4",
    fee: 1200,
    cap: 8,
    settings: {
      advancePerPool: 2,
      maxRosterSize: 6,
      formatRounds: [
        { format: "round-robin", scoring: mixedR1Scoring, durationMinutes: 45 },
        { format: "single", scoring: mixedR2Scoring, durationMinutes: 60 }
      ],
    }
  });
  addT2Teams(t2Mixed, 8, 30, 4, 0);
  rounds.push({ id: nextId("round"), division_id: t2Mixed, sequence: 1, format: "round-robin", name: "Round 1", scoring_rules: mixedR1Scoring });
  rounds.push({ id: nextId("round"), division_id: t2Mixed, sequence: 2, format: "single", name: "Round 2", scoring_rules: mixedR2Scoring });

  // T2 Division 4: Junior Open (Announced / Opens Soon - 0 teams)
  const t2Junior = addT2Division({
    name: "Junior Open",
    format: "2v2",
    fee: 600,
    cap: 8,
    settings: {
      advancePerPool: 2,
      maxRosterSize: 2,
      registrationOpenDate: new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10),
      registrationCloseDate: new Date(now.getTime() + 13 * 86400000).toISOString().slice(0, 10),
      formatRounds: [
        { format: "round-robin", scoring: scoringR1, durationMinutes: 30 },
        { format: "single", scoring: scoringR2, durationMinutes: 45 }
      ],
    }
  });
  rounds.push({ id: nextId("round"), division_id: t2Junior, sequence: 1, format: "round-robin", name: "Round 1", scoring_rules: scoringR1 });
  rounds.push({ id: nextId("round"), division_id: t2Junior, sequence: 2, format: "single", name: "Round 2", scoring_rules: scoringR2 });

  // T2 Division 5: Masters 40+ (Announced / Opens Soon - 0 teams)
  const t2Masters = addT2Division({
    name: "Masters 40+",
    format: "2v2",
    fee: 800,
    cap: 8,
    settings: {
      advancePerPool: 2,
      maxRosterSize: 2,
      ageLimit: "40+",
      registrationOpenDate: new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10),
      registrationCloseDate: new Date(now.getTime() + 13 * 86400000).toISOString().slice(0, 10),
      formatRounds: [
        { format: "round-robin", scoring: scoringR1, durationMinutes: 30 },
        { format: "single", scoring: scoringR2, durationMinutes: 45 }
      ],
    }
  });
  rounds.push({ id: nextId("round"), division_id: t2Masters, sequence: 1, format: "round-robin", name: "Round 1", scoring_rules: scoringR1 });
  rounds.push({ id: nextId("round"), division_id: t2Masters, sequence: 2, format: "single", name: "Round 2", scoring_rules: scoringR2 });

  // Vouchers for Tournament 2
  vouchers.push({
    id: nextId("voucher"),
    tournament_id: t2Id,
    code: "KHAOLAK10",
    discount_type: "percent",
    discount_value: 10,
    max_uses: 30,
    uses_count: 2,
  });

  return {
    organizers,
    tournaments,
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
    if (table === "tournaments" && error.message.includes("is_template")) {
      console.log("is_template column not found, inserting without is_template column");
      const cleaned = rows.map(({ is_template, ...rest }) => rest);
      const { error: retryErr } = await supabase.from(table).insert(cleaned);
      if (retryErr) throw new Error(`Insert into ${table} failed: ${retryErr.message}`);
      console.log(`Inserted ${cleaned.length} rows into ${table} (without is_template)`);
      return;
    }
    throw new Error(`Insert into ${table} failed: ${error.message}`);
  }
  console.log(`Inserted ${rows.length} rows into ${table}`);
}

async function cleanupExistingTemplates() {
  const { data: existing } = await supabase
    .from("tournaments")
    .select("id, slug")
    .in("slug", [TEMPLATE_SLUG_1, TEMPLATE_SLUG_2]);

  if (existing && existing.length > 0) {
    const ids = existing.map(e => e.id);
    console.log(`Cleaning up ${ids.length} existing template tournaments...`);
    const { error } = await supabase.from("tournaments").delete().in("id", ids);
    if (error) console.warn("Could not delete old templates:", error.message);
  }

  await supabase.from("organizers").delete().eq("email", "template.organizer@livebracket.app");
}

async function main() {
  console.log("Building Golden Template dataset (both tournaments)...");
  const data = await buildGoldenTemplate();

  console.log("Cleaning up any previous templates...");
  await cleanupExistingTemplates();

  console.log("Seeding golden templates to Supabase...");
  await insertAll("organizers", data.organizers);
  await insertAll("tournaments", data.tournaments);
  await insertAll("divisions", data.divisions);
  await insertAll("rounds", data.rounds);
  await insertAll("teams", data.teams);
  await insertAll("players", data.players);
  await insertAll("registrations", data.registrations);
  await insertAll("matches", data.matches);
  await insertAll("vouchers", data.vouchers);

  console.log('\nGolden templates successfully seeded:');
  console.log(`- Tournaments: ${data.tournaments.length}`);
  console.log(`  1. ${data.tournaments[0].title} (${TEMPLATE_SLUG_1}) — ${data.matches.length} matches, active schedule`);
  console.log(`  2. ${data.tournaments[1].title} (${TEMPLATE_SLUG_2}) — 5 divisions (3 full with 0 matches, 2 announced)`);
  console.log(`- Divisions: ${data.divisions.length} total`);
  console.log(`- Teams: ${data.teams.length} total`);
  console.log(`- Players: ${data.players.length} total`);
  console.log(`- Matches: ${data.matches.length} total`);
  console.log(`- Vouchers: ${data.vouchers.length} total`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal seed error:", err);
    process.exit(1);
  });
}

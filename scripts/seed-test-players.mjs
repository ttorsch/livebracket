// Seeds three test player accounts for exercising the player-ID search and
// team-invite flow. Run with:
//   node --env-file=.env.local scripts/seed-test-players.mjs
//
// Uses the service-role key (bypasses RLS) — never run this against a
// database you don't own, and never import this pattern into app code.
//
// Idempotent: re-running finds the existing accounts by email and prints
// their details again rather than creating duplicates.
//
// These are real rows in auth.users, because profiles.id is a foreign key
// to it — a profile cannot exist without an account behind it. They are
// created WITHOUT a password on purpose: a seed script has no business
// minting credentials. See the note the script prints at the end for how
// to sign in as one if you need to.
//
// The domain is example.com, which RFC 2606 reserves and which cannot
// receive mail — so nothing here can accidentally email a real person.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const PLAYERS = [
  { email: 'niran.chaiwat@example.com',  name: 'Niran Chaiwat',  club: 'Khao Lak Volley',    hometown: 'Khao Lak, Thailand' },
  { email: 'mali.sunthorn@example.com',  name: 'Mali Sunthorn',  club: 'Bang Niang BVC',     hometown: 'Takua Pa, Thailand' },
  { email: 'lukas.berg@example.com',     name: 'Lukas Berg',     club: 'Andaman Beach Club', hometown: 'Malmö, Sweden' },
];

// Random rather than sequential, matching lib/profiles.ts: a sequential id
// would let anyone holding one count the platform's accounts.
const randomPlayerId = () => String(Math.floor(Math.random() * 90_000_000) + 10_000_000);

async function findUserByEmail(email) {
  // listUsers is paginated; these seeds land on page one of a small
  // project, but page through anyway so the script stays correct.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(player) {
  const existing = await findUserByEmail(player.email);
  if (existing) return { user: existing, created: false };

  const { data, error } = await supabase.auth.admin.createUser({
    email: player.email,
    // Confirmed so claimTeamsForUser will treat the address as verified —
    // an unconfirmed account is deliberately not allowed to claim rows.
    email_confirm: true,
    user_metadata: { full_name: player.name, name: player.name },
  });
  if (error) throw new Error(`createUser(${player.email}) failed: ${error.message}`);
  return { user: data.user, created: true };
}

async function ensureProfile(user, player) {
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('id, player_id, name, club, hometown')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) throw new Error(`profile read failed: ${readError.message}`);

  if (existing) {
    // Keep the details fresh, but never rewrite player_id — anything
    // already invited points at it.
    const { data, error } = await supabase
      .from('profiles')
      .update({ name: player.name, club: player.club, hometown: player.hometown })
      .eq('id', user.id)
      .select('id, player_id, name, club, hometown')
      .single();
    if (error) throw new Error(`profile update failed: ${error.message}`);
    return { profile: data, created: false };
  }

  // Retry on the unique constraint rather than checking first: the check
  // would be a race, the constraint is not.
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        player_id: randomPlayerId(),
        name: player.name,
        club: player.club,
        hometown: player.hometown,
      })
      .select('id, player_id, name, club, hometown')
      .single();

    if (!error) return { profile: data, created: true };
    if (error.code !== '23505') throw new Error(`profile insert failed: ${error.message}`);
  }
  throw new Error(`Could not allocate a unique player_id for ${player.email}`);
}

const rows = [];
for (const player of PLAYERS) {
  const { user, created: userCreated } = await ensureUser(player);
  const { profile } = await ensureProfile(user, player);
  rows.push({
    'Player ID': profile.player_id,
    Name: profile.name,
    Email: user.email,
    Club: profile.club,
    Hometown: profile.hometown,
    'User ID': user.id,
    Account: userCreated ? 'created' : 'existing',
  });
}

console.table(rows);
console.log(
  '\nThese accounts have no password. To sign in as one, either send a magic\n' +
  'link from the Supabase dashboard (Authentication → Users → … → Send magic\n' +
  'link) or set a password there yourself. The seed script deliberately does\n' +
  'not create credentials.\n'
);

-- Sandboxes for the try-it-yourself demo.
--
-- Every visitor gets their own private copy of the golden template tournament,
-- which expires after 24 hours. The sandbox row ties the throwaway auth user,
-- the throwaway organizer, and the cloned tournament together so they can be
-- swept in one cascade deletion.

create table if not exists sandboxes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

comment on table sandboxes is
  'Ephemeral visitor sandbox sessions. Swept hourly once expires_at has passed.';

comment on column sandboxes.auth_user_id is
  'Throwaway auth.users entry created for this demo visitor.';

comment on column sandboxes.expires_at is
  'When this sandbox and all its cloned data will be pruned by the sweeper cron.';

-- Tie tournaments and organizers to their sandbox if they are ephemeral copies.
-- ON DELETE CASCADE ensures deleting a sandbox row cascades to wipe all its data.
alter table tournaments
  add column if not exists sandbox_id uuid references sandboxes (id) on delete cascade,
  add column if not exists is_template boolean not null default false;

alter table organizers
  add column if not exists sandbox_id uuid references sandboxes (id) on delete cascade;

comment on column tournaments.sandbox_id is
  'Links a cloned tournament to its visitor sandbox session. Null for production tournaments.';

comment on column tournaments.is_template is
  'True for the golden template tournament used as the cloning source for sandboxes.';

comment on column organizers.sandbox_id is
  'Links a throwaway organizer to its visitor sandbox session. Null for real organizers.';

-- Indexes for sweeper queries and sandbox scoping
create index if not exists sandboxes_expires_at_idx
  on sandboxes (expires_at);

create index if not exists tournaments_sandbox_id_idx
  on tournaments (sandbox_id)
  where sandbox_id is not null;

create index if not exists tournaments_is_template_idx
  on tournaments (is_template)
  where is_template = true;

create index if not exists organizers_sandbox_id_idx
  on organizers (sandbox_id)
  where sandbox_id is not null;

alter table sandboxes enable row level security;

-- Public can read sandboxes for countdown / status checks; writes happen through service role
create policy "Public read sandboxes"
  on sandboxes for select
  using (true);

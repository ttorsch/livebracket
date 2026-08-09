-- Scorekeeper access tokens.
--
-- The scorekeeper screen (/score/<token>) is deliberately unauthenticated:
-- a referee scans a QR at the court and starts tapping points, with no
-- account and no login. The token in the URL *is* the credential, so it has
-- to be unguessable rather than derived from anything public (a match id is
-- handed out in API responses and would be trivially enumerable).
--
-- 16 random bytes -> 32 hex chars. gen_random_bytes comes from pgcrypto,
-- enabled in 0001. Because the default is evaluated per row, this one
-- statement both backfills every existing match and gives every future
-- match a token automatically — no application code has to remember to
-- mint one.
alter table matches
  add column scorekeeper_token text not null default encode(gen_random_bytes(16), 'hex');

-- Uniqueness is what makes the token safe to look a match up by. The unique
-- index is also the lookup index: /score/<token> resolves through it on
-- every request.
alter table matches
  add constraint matches_scorekeeper_token_key unique (scorekeeper_token);

-- Revoking a leaked or reprinted code is "give this match a new token",
-- which the organizer triggers from the dashboard.
comment on column matches.scorekeeper_token is
  'Unguessable bearer token for the public /score/<token> screen. Rotate to revoke a printed QR.';

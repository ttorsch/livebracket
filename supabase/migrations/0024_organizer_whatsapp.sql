-- An organizer's WhatsApp number, so a visitor can reach them there.
--
-- ── Why a column rather than reusing something ───────────────────
-- Organizers had no phone number at all. Teams have `contact_phone` and
-- players have `phone`, but an organizer only ever had an email — so
-- "message this organizer on WhatsApp" had nothing to point at.
--
-- ── What is stored ───────────────────────────────────────────────
-- Public numbers use full international digits with no leading + or zeroes:
-- "66812345678", never "081 234 5678" or "+66 81 234 5678". A private
-- number has one leading "!" visibility marker ("!66812345678"); the
-- digits remain available to the organizer while the public link helper
-- refuses to build a wa.me URL. Normalising and visibility encoding happen
-- once, on save, in lib/whatsappNumber.ts.
--
-- Null means the organizer has not given one, which is the normal case
-- and the reason the button is absent rather than broken.
--
-- ── Why no grant for anon ────────────────────────────────────────
-- Migration 0013 replaced the table-wide select grant on `organizers`
-- with a column list, and a column added afterwards is not covered by it.
-- That is deliberate here: the number reaches the public card through
-- lib/organizerCard.ts, which reads over the service role. Nothing in the
-- browser selects this column directly, so nothing needs the grant — and
-- leaving it ungranted means a future `select *` from the anon client
-- fails loudly instead of quietly publishing it somewhere new.

alter table organizers
  add column if not exists whatsapp text;

comment on column organizers.whatsapp is
  'WhatsApp number in international digits, no plus and no leading zero. '
  'A leading ! marks it private and suppresses the public contact button. Written only by '
  '/api/organizer after lib/whatsappNumber.ts has normalised it. Null when '
  'the organizer has not set one.';

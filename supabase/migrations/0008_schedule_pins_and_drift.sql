-- The rebuilt schedule generator needs three things the matches table cannot
-- currently express.
--
-- 1. Two times, not one.
--    A published schedule is a promise: the time players screenshot and the
--    venue prints must not move. But matches run long, so the live board has to
--    show something else. Splitting them is the only honest way to have both:
--
--      planned_time    frozen when the organizer publishes. Never moves.
--      scheduled_time  the live projection, recomputed from real results.
--                      Keeps its existing meaning, so every current reader
--                      (bracket pages, score keeper, live cards) is unaffected.
--
--    Existing rows are backfilled from scheduled_time, so a schedule generated
--    before this migration reads as "published exactly as planned".
--
-- 2. Pinned matches.
--    Organizers drag a match to a court and time by hand, and today the next
--    regenerate wipes it — which is why they stop trusting the generator. A
--    pinned match becomes a hard constraint the generator schedules *around*
--    rather than over. It also means an over-pinned tournament can genuinely
--    have no legal schedule; the generator reports which pins conflict instead
--    of silently unpinning them.
--
-- 3. Referee duty.
--    Modelled now, filled in by hand for the moment. The scheduler already
--    treats a refereeing team's time as court time when working out rest, so
--    turning on automatic assignment later needs no further schema change.
--
-- Court attributes (net height, show court) deliberately do NOT get a table
-- here: they live in tournaments.schedule_config under `courts`, alongside the
-- rest of the venue configuration added in 0007, following the same
-- single-jsonb-blob pattern as divisions.settings (0003).
--
--   { startTime, endTime, courtCount, blockMinutes, lunchStart, lunchEnd,
--     netBufferMinutes, maxMatchesPerTeamPerDay,
--     courts: [{ name, netHeight, isShowCourt }],
--     minRestSlots, restIsHard, staggerLunch, finalsOnLastDay,
--     dayPlan: 'parallel-daily' | 'compress-division',
--     repairIterations, weights: { ... } }

alter table matches
  add column planned_time timestamptz,
  add column pinned boolean not null default false,
  add column referee_team_id uuid references teams (id);

-- Anything already scheduled was, by definition, scheduled as planned.
update matches
set planned_time = scheduled_time
where scheduled_time is not null;

-- The schedule views read "everything on court X, in order", which is the one
-- access pattern that got materially more common with the day grid.
create index if not exists matches_court_planned_time_idx
  on matches (court, planned_time);

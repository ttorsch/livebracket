-- The schedule generator needs venue/day constraints that the tournament
-- never stored: day start/end time-of-day (tournaments only had calendar
-- dates), court count, match/block duration, the lunch window, and the
-- net-height swap buffer. Like divisions.settings (0003), keep them in a
-- single jsonb blob rather than a dozen narrow columns.
--
-- Shape (all optional; the app supplies defaults):
--   { startTime: "09:00", endTime: "18:00", courtCount: 4,
--     blockMinutes: 45, lunchStart: "12:00", lunchEnd: "13:00",
--     netBufferMinutes: 15 }
--
-- Per-division dedicated-court overrides (D_d) reuse the existing
-- divisions.settings blob at settings.schedule.dedicatedCourts — no new
-- column needed there.

alter table tournaments
  add column schedule_config jsonb not null default '{}'::jsonb;

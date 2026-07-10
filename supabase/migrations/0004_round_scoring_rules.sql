-- Scoring rules move from the division to the round: a pool play round
-- might play to 21 points while the single-elimination round after it is
-- best of 3, so one scoring_rules blob per division isn't enough.

alter table rounds
  add column scoring_rules jsonb not null default '{}'::jsonb;

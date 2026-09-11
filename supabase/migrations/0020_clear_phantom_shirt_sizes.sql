-- Clear shirt sizes belonging to divisions that never asked for one.
--
-- Both registration paths seeded a default apparel size ('M', or the first
-- of a fallback S-XL list) into every player and posted it regardless of
-- whether the division had added the apparel question. The organizer's team
-- views then rendered a hardcoded "Shirt size" row, so the invented value
-- looked like an answer somebody had given.
--
-- The code no longer seeds or renders a size for a division without the
-- apparel preset; this clears what the old behaviour already wrote. A
-- division that really asks keeps every answer.
--
-- Legacy reg_fields (the '{"key": ...}' shape, which normalizeRegFields
-- discards in favour of the three base questions) carry no preset at all,
-- so they are correctly treated as not asking.

update players p
set shirt_size = null
from teams t
join divisions d on d.id = t.division_id
where p.team_id = t.id
  and p.shirt_size is not null
  and not exists (
    select 1
    from jsonb_array_elements(d.reg_fields) f
    where f ->> 'preset' = 'apparel'
  );

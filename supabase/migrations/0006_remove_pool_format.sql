-- 'pool' and 'round-robin' were two names for the same format. Collapse
-- everything onto 'round-robin' and drop 'pool' from the allowed formats.

update rounds
set format = 'round-robin',
    name = replace(name, 'Pool Play', 'Round Robin')
where format = 'pool';

alter table rounds drop constraint rounds_format_check;
alter table rounds add constraint rounds_format_check
  check (format in ('round-robin', 'single', 'double'));

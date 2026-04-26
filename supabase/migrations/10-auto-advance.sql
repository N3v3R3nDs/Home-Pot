-- Home Pot — auto-advance level when timer hits 0
alter table public.tournaments
  add column if not exists auto_advance boolean not null default true;

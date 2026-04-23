-- Home Pot — tournament types
alter table public.tournaments add column if not exists tournament_type text not null default 'rebuy'
  check (tournament_type in ('rebuy', 'freezeout', 'reentry', 'bounty'));

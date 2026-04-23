-- Home Pot — club features: seasons, tournament templates, rake/dealer tip,
-- late registration, member roles.

-- ─────────────────────────────────────────── seasons
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now()
);

alter table public.tournaments add column if not exists season_id uuid references public.seasons(id) on delete set null;
alter table public.cash_games  add column if not exists season_id uuid references public.seasons(id) on delete set null;
create index if not exists idx_tournaments_season on public.tournaments(season_id);
create index if not exists idx_cash_games_season  on public.cash_games(season_id);

alter publication supabase_realtime add table public.seasons;
alter table public.seasons enable row level security;
create policy "auth read seasons"  on public.seasons for select using (auth.role() = 'authenticated');
create policy "auth write seasons" on public.seasons for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────── tournament templates
create table if not exists public.tournament_templates (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  buy_in              numeric not null,
  rebuy_amount        numeric,
  addon_amount        numeric,
  starting_stack      integer not null,
  rebuy_stack         integer,
  addon_stack         integer,
  bounty_amount       numeric not null default 0,
  rebuys_until_level  integer not null default 6,
  blind_structure     jsonb not null,
  payout_structure    jsonb not null,
  rake_percent        numeric not null default 0,
  dealer_tip_percent  numeric not null default 0,
  currency            text not null default 'NOK',
  created_at          timestamptz not null default now()
);

alter publication supabase_realtime add table public.tournament_templates;
alter table public.tournament_templates enable row level security;
create policy "auth read tt"  on public.tournament_templates for select using (auth.role() = 'authenticated');
create policy "auth write tt" on public.tournament_templates for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────── rake & dealer tip on tournaments
alter table public.tournaments add column if not exists rake_percent numeric not null default 0;
alter table public.tournaments add column if not exists dealer_tip_percent numeric not null default 0;

-- ─────────────────────────────────────────── late registration flag + entry-level
alter table public.tournament_players add column if not exists late_reg boolean not null default false;
alter table public.tournament_players add column if not exists entry_level integer; -- which blind level they bought in at

-- ─────────────────────────────────────────── member roles
-- Lightweight: a single 'admin' boolean. Default false. Hosts of the original
-- Home Pot install can be promoted manually with: update profiles set is_admin=true where ...
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Refresh the members view so account_type / is_admin are exposed
drop view if exists public.members;
create view public.members as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  u.email,
  coalesce(u.is_anonymous, false) as is_anonymous,
  coalesce(p.is_admin, false) as is_admin,
  case
    when coalesce(u.is_anonymous, false) then 'anonymous'
    when u.email like '%@home-pot.local' then 'pin'
    when u.email is not null then 'email'
    else 'unknown'
  end as account_type,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id;

grant select on public.members to authenticated;

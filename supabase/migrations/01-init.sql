-- Home Pot — initial schema
-- Loaded automatically by the supabase/postgres image on first boot
-- (mounted at /docker-entrypoint-initdb.d via docker-compose)

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar_emoji  text default '🃏',
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Sessions (a poker night) — host owns it
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  currency    text not null default 'NOK',
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

-- Roster: who the host has invited to tonight's session
create table if not exists public.session_participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  guest_name   text,
  added_at     timestamptz not null default now(),
  unique (session_id, profile_id),
  check (profile_id is not null or guest_name is not null)
);

-- ---------------------------------------------------------------------------
-- Tournaments — host owns and runs
-- ---------------------------------------------------------------------------
create table if not exists public.tournaments (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid references public.sessions(id) on delete set null,
  host_id             uuid not null references public.profiles(id) on delete cascade,
  name                text not null,
  buy_in              numeric not null,
  rebuy_amount        numeric,
  addon_amount        numeric,
  starting_stack      integer not null,
  rebuy_stack         integer,
  addon_stack         integer,
  bounty_amount       numeric not null default 0,
  rebuys_until_level  integer not null default 6,
  blind_structure     jsonb not null,                -- [{ level, sb, bb, ante, durationMin, breakAfter }]
  payout_structure    jsonb not null,                -- [{ place, percent }]
  chip_distribution   jsonb,                         -- per-player starting stack as denomination map
  state               text not null default 'setup' check (state in ('setup','running','paused','finished')),
  current_level       integer not null default 0,
  level_started_at    timestamptz,
  paused_at           timestamptz,
  pause_elapsed_ms    bigint not null default 0,
  currency            text not null default 'NOK',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tournament players (entry per player per tournament)
-- profile_id may be null for guests (use guest_name)
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_players (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments(id) on delete cascade,
  profile_id          uuid references public.profiles(id) on delete set null,
  guest_name          text,
  buy_ins             integer not null default 1,
  rebuys              integer not null default 0,
  addons              integer not null default 0,
  bounties_won        integer not null default 0,
  finishing_position  integer,
  eliminated_by       uuid references public.tournament_players(id) on delete set null,
  eliminated_at       timestamptz,
  prize               numeric not null default 0,
  created_at          timestamptz not null default now(),
  check (profile_id is not null or guest_name is not null)
);

create index if not exists idx_tplayers_tournament on public.tournament_players(tournament_id);

-- ---------------------------------------------------------------------------
-- Cash games — host owns
-- ---------------------------------------------------------------------------
create table if not exists public.cash_games (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid references public.sessions(id) on delete set null,
  host_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  small_blind   numeric,
  big_blind     numeric,
  currency      text not null default 'NOK',
  state         text not null default 'running' check (state in ('running','finished')),
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create table if not exists public.cash_game_players (
  id            uuid primary key default gen_random_uuid(),
  cash_game_id  uuid not null references public.cash_games(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,
  guest_name    text,
  cash_out      numeric,                         -- null while still playing
  created_at    timestamptz not null default now(),
  check (profile_id is not null or guest_name is not null)
);

create table if not exists public.cash_buy_ins (
  id                    uuid primary key default gen_random_uuid(),
  cash_game_player_id   uuid not null references public.cash_game_players(id) on delete cascade,
  amount                numeric not null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_cgp_game on public.cash_game_players(cash_game_id);
create index if not exists idx_cbi_player on public.cash_buy_ins(cash_game_player_id);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  public.profiles,
  public.sessions,
  public.session_participants,
  public.tournaments,
  public.tournament_players,
  public.cash_games,
  public.cash_game_players,
  public.cash_buy_ins;

-- ---------------------------------------------------------------------------
-- Row level security
--   - any authenticated friend can READ everything (it's their own group)
--   - WRITES are gated:
--       * profile: only self
--       * session / tournament / cash_game: only the host
--       * tournament_players, cash_game_players, cash_buy_ins: only the
--         tournament/cash-game host (host runs the controls)
-- ---------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.sessions              enable row level security;
alter table public.session_participants  enable row level security;
alter table public.tournaments           enable row level security;
alter table public.tournament_players    enable row level security;
alter table public.cash_games            enable row level security;
alter table public.cash_game_players     enable row level security;
alter table public.cash_buy_ins          enable row level security;

-- profiles
create policy "auth read profiles"  on public.profiles for select using (auth.role() = 'authenticated');
create policy "self write profile"  on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- sessions
create policy "auth read sessions"  on public.sessions for select using (auth.role() = 'authenticated');
create policy "host write sessions" on public.sessions for all
  using (host_id = auth.uid()) with check (host_id = auth.uid());

-- session_participants — host of the session controls roster
create policy "auth read sp"        on public.session_participants for select using (auth.role() = 'authenticated');
create policy "host write sp"       on public.session_participants for all
  using (exists (select 1 from public.sessions s where s.id = session_id and s.host_id = auth.uid()))
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.host_id = auth.uid()));

-- tournaments
create policy "auth read tour"      on public.tournaments for select using (auth.role() = 'authenticated');
create policy "host write tour"     on public.tournaments for all
  using (host_id = auth.uid()) with check (host_id = auth.uid());

-- tournament_players — only the tournament host can write
create policy "auth read tplayers"  on public.tournament_players for select using (auth.role() = 'authenticated');
create policy "host write tplayers" on public.tournament_players for all
  using (exists (select 1 from public.tournaments t where t.id = tournament_id and t.host_id = auth.uid()))
  with check (exists (select 1 from public.tournaments t where t.id = tournament_id and t.host_id = auth.uid()));

-- cash games
create policy "auth read cgames"    on public.cash_games for select using (auth.role() = 'authenticated');
create policy "host write cgames"   on public.cash_games for all
  using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy "auth read cgp"       on public.cash_game_players for select using (auth.role() = 'authenticated');
create policy "host write cgp"      on public.cash_game_players for all
  using (exists (select 1 from public.cash_games g where g.id = cash_game_id and g.host_id = auth.uid()))
  with check (exists (select 1 from public.cash_games g where g.id = cash_game_id and g.host_id = auth.uid()));

create policy "auth read cbi"       on public.cash_buy_ins for select using (auth.role() = 'authenticated');
create policy "host write cbi"      on public.cash_buy_ins for all
  using (exists (
    select 1 from public.cash_game_players p
    join public.cash_games g on g.id = p.cash_game_id
    where p.id = cash_game_player_id and g.host_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cash_game_players p
    join public.cash_games g on g.id = p.cash_game_id
    where p.id = cash_game_player_id and g.host_id = auth.uid()
  ));
